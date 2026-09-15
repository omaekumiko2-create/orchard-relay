#!/usr/bin/env python3
"""Mac worker. Invoked over SSH. Python standard library only."""
import contextlib
import fcntl
import json
import os
import pathlib
import plistlib
import re
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
import traceback
import zipfile

BASE = pathlib.Path.home() / '.local/share/orchard-relay'
ACTIVE = {'queued', 'preparing', 'building', 'installing', 'launching', 'packaging'}


def write_json(file, data):
    temp = file.with_suffix('.tmp')
    temp.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
    temp.replace(file)


def job_dir(job_id):
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,63}', job_id):
        raise ValueError('Invalid job ID')
    return BASE / 'jobs' / job_id


def safe_relative(text):
    p = pathlib.PurePosixPath(text)
    if not text or p.is_absolute() or '..' in p.parts or '\\' in text or '\x00' in text:
        raise ValueError('Unsafe relative path')
    return p


def limited_run(args, timeout=30):
    r = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if r.returncode:
        raise RuntimeError((r.stderr or r.stdout)[-8000:])
    return r.stdout


def device_json(args, timeout=40):
    with tempfile.TemporaryDirectory(prefix='orchard-device-') as td:
        out = pathlib.Path(td) / 'device.json'
        limited_run(['xcrun', 'devicectl'] + args + ['--timeout', str(timeout), '--json-output', str(out)], timeout + 10)
        data = json.loads(out.read_text())
        if data.get('info', {}).get('outcome') != 'success':
            raise RuntimeError('devicectl returned an unsuccessful result')
        return data.get('result', {})


def health():
    devices = device_json(['list', 'devices']).get('devices', [])
    return {
        'xcode': limited_run(['xcodebuild', '-version']).strip(),
        'macOS': limited_run(['sw_vers', '-productVersion']).strip(),
        'devices': [{
            'id': d['identifier'],
            'name': d.get('deviceProperties', {}).get('name', 'iPhone'),
            'model': d.get('hardwareProperties', {}).get('marketingName', 'iPhone'),
            'os': d.get('deviceProperties', {}).get('osVersionNumber', ''),
            'developerMode': d.get('deviceProperties', {}).get('developerModeStatus', 'unknown'),
            'paired': d.get('connectionProperties', {}).get('pairingState') == 'paired',
            'transport': d.get('connectionProperties', {}).get('transportType', ''),
            'tunnel': d.get('connectionProperties', {}).get('tunnelState', ''),
            'available': d.get('connectionProperties', {}).get('tunnelState') != 'unavailable'
        } for d in devices if d.get('hardwareProperties', {}).get('platform') == 'iOS'],
        'checkedAt': time.time()
    }


class Cancelled(Exception):
    pass


class Worker:
    def __init__(self, job_id):
        self.directory = job_dir(job_id)
        self.config = json.loads((self.directory / 'request.json').read_text())
        self.state = {'id': job_id, 'status': 'preparing', 'startedAt': time.time(), 'pid': os.getpid()}
        self.child = None
        # The SSH session supplies this through an anonymous pipe, never a file.
        self.keychain_password = sys.stdin.read()

    def update(self, status, **extra):
        self.state.update(status=status, updatedAt=time.time(), **extra)
        write_json(self.directory / 'status.json', self.state)

    def log(self, message):
        print(time.strftime('[%H:%M:%S] ') + message, flush=True)

    def check_cancel(self):
        if (self.directory / 'cancel').exists():
            raise Cancelled('用户已取消')

    def run_command(self, args, cwd=None, timeout=1800):
        self.check_cancel()
        # Shell-free arguments; Xcode output streams directly into the job log.
        self.child = subprocess.Popen(args, cwd=cwd, stdout=sys.stdout, stderr=sys.stdout,
                                      start_new_session=True, env={**os.environ, 'NSUnbufferedIO': 'YES'})
        deadline = time.monotonic() + timeout
        try:
            while self.child.poll() is None:
                self.check_cancel()
                if time.monotonic() > deadline:
                    raise TimeoutError('命令超时；检查签名钥匙串、设备连接或网络。')
                time.sleep(0.5)
            if self.child.returncode:
                raise RuntimeError('命令失败，退出码 %s：%s' % (self.child.returncode, args[0]))
        finally:
            if self.child.poll() is None:
                with contextlib.suppress(ProcessLookupError):
                    os.killpg(self.child.pid, signal.SIGTERM)
                try:
                    self.child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    with contextlib.suppress(ProcessLookupError):
                        os.killpg(self.child.pid, signal.SIGKILL)
                    self.child.wait()
            self.child = None

    def source(self):
        p = self.config['project']
        if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,63}', p['id']):
            raise ValueError('Invalid project ID')
        project_base = BASE / 'projects' / p['id']
        project_base.mkdir(parents=True, exist_ok=True)
        staging = self.directory / 'source'
        staging.mkdir()
        self.log('解包 Windows 源码快照')
        total = 0
        with tarfile.open(self.directory / 'source.tar.gz', 'r:gz') as archive:
            for member in archive:
                self.check_cancel()
                rel = safe_relative(member.name)
                target = staging / rel
                if member.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                elif member.isfile():
                    total += member.size
                    if total > 1024**3:
                        raise ValueError('解包大小超出 1 GB')
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with archive.extractfile(member) as src, target.open('wb') as dst:
                        shutil.copyfileobj(src, dst)
                    target.chmod(member.mode & 0o777)
                else:
                    raise ValueError('归档包含链接或不支持的文件类型')
        original = pathlib.Path(p['remoteRoot']).expanduser().resolve()
        git = subprocess.run(['git', '-C', str(original), 'status', '--porcelain'], capture_output=True, text=True)
        if git.returncode == 0:
            self.log('Mac 原仓库状态已检查，%d 项本地变化；本次使用独立副本' % len(git.stdout.splitlines()))
        for name in p.get('macConfigFiles', []):
            rel = safe_relative(name)
            if not name.endswith('.xcconfig'):
                raise ValueError('Mac 配置仅限 xcconfig')
            config = original / rel
            if config.exists():
                if config.is_symlink() or original not in config.resolve().parents:
                    raise ValueError('配置文件越过原仓库')
                target = staging / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(config, target)
                self.log('已复用 Mac 本地配置：' + name)
        project_path = staging / safe_relative(p['projectPath'])
        if not project_path.is_dir():
            raise ValueError('快照中找不到 Xcode 工程')
        # Fixed source location lets Xcode reuse incremental build products.
        destination = project_base / 'source'
        if destination.exists():
            if destination.is_symlink() or destination.resolve().parent != project_base.resolve():
                raise ValueError('构建副本目录不安全')
            # Preserve mtimes of unchanged sources for incremental compilation.
            for new_file in staging.rglob('*'):
                if new_file.is_file():
                    old_file = destination / new_file.relative_to(staging)
                    if old_file.is_file() and not old_file.is_symlink() and old_file.stat().st_size == new_file.stat().st_size:
                        if old_file.read_bytes() == new_file.read_bytes():
                            shutil.copystat(old_file, new_file)
            shutil.rmtree(destination)
        staging.rename(destination)
        return destination, project_base / 'DerivedData'

    def build(self):
        self.update('preparing')
        self.check_cancel()
        p = self.config['project']
        source, derived = self.source()
        self.check_cancel()
        self.update('building')
        self.log('开始编译 %s · %s' % (p['name'], p['configuration']))
        project = source / safe_relative(p['projectPath'])
        if project.suffix not in ('.xcodeproj', '.xcworkspace'):
            raise ValueError('Unsupported Xcode project')
        args = ['xcodebuild', '-workspace' if project.suffix == '.xcworkspace' else '-project', str(project),
                '-scheme', p['scheme'], '-configuration', p['configuration'], '-sdk', 'iphoneos',
                '-destination', 'generic/platform=iOS', '-derivedDataPath', str(derived),
                '-allowProvisioningUpdates', '-allowProvisioningDeviceRegistration', 'build']
        if p.get('team'):
            args.append('DEVELOPMENT_TEAM=' + p['team'])
        self.run_command(args, cwd=source)
        product_dir = derived / 'Build/Products' / (p['configuration'] + '-iphoneos')
        matches = []
        for app in product_dir.glob('*.app'):
            with (app / 'Info.plist').open('rb') as f:
                info = plistlib.load(f)
            if info.get('CFBundleIdentifier') == p['bundleId']:
                matches.append(app)
        if len(matches) != 1:
            raise RuntimeError('无法唯一定位 .app，请检查项目 Bundle ID。')
        app = matches[0]
        self.run_command(['codesign', '--verify', '--deep', '--strict', str(app)], timeout=60)
        self.update('packaging', built=True)
        self.log('保存签名后的 .app 构建产物')
        self.run_command(['ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', str(app), str(self.directory / 'app.zip')], timeout=180)
        self.state['artifact'] = app.name + '.zip'
        return app

    def execute(self):
        p = self.config['project']
        if self.config['action'] == 'install':
            previous = job_dir(self.config['sourceJobId'])
            old_request = json.loads((previous / 'request.json').read_text())
            if old_request['project']['id'] != p['id'] or old_request['project']['bundleId'] != p['bundleId']:
                raise ValueError('安装包与所选项目不匹配')
            self.update('preparing')
            artifact_dir = self.directory / 'artifact'
            artifact_dir.mkdir()
            with zipfile.ZipFile(previous / 'app.zip') as archive:
                for name in archive.namelist():
                    safe_relative(name)
            self.run_command(['ditto', '-x', '-k', str(previous / 'app.zip'), str(artifact_dir)], timeout=120)
            apps = list(artifact_dir.glob('*.app'))
            if len(apps) != 1:
                raise ValueError('安装包中找不到唯一的应用')
            app = apps[0]
            with (app / 'Info.plist').open('rb') as f:
                if plistlib.load(f).get('CFBundleIdentifier') != p['bundleId']:
                    raise ValueError('安装包的 Bundle ID 不匹配')
            self.run_command(['codesign', '--verify', '--deep', '--strict', str(app)], timeout=60)
            shutil.copy2(previous / 'app.zip', self.directory / 'app.zip')
            self.state.update(built=True, artifact=app.name + '.zip')
            self.log('使用已构建的版本，无需重新编译')
        else:
            app = self.build()
        if self.config['action'] in ('build-install', 'install'):
            device = self.config.get('deviceId', '')
            if not device:
                raise ValueError('请选择一台连接到 Mac 的 iPhone')
            devices = device_json(['list', 'devices']).get('devices', [])
            selected = next((d for d in devices if d['identifier'] == device), None)
            if not selected or selected.get('connectionProperties', {}).get('tunnelState') == 'unavailable':
                raise RuntimeError('签名构建已保存，但 iPhone 当前未连接。请连接并解锁手机，再点击“安装此版本”。')
            self.update('installing')
            self.log('安装到已选 iPhone；保留现有应用数据')
            install_json = self.directory / 'install.json'
            self.run_command(['xcrun', 'devicectl', 'device', 'install', 'app', '--device', device, str(app),
                              '--timeout', '180', '--json-output', str(install_json)], timeout=200)
            if json.loads(install_json.read_text()).get('info', {}).get('outcome') != 'success':
                raise RuntimeError('设备安装未返回成功')
            self.state['installed'] = True
            self.update('launching')
            self.log('在手机上启动 ' + p['name'])
            launch_json = self.directory / 'launch.json'
            self.run_command(['xcrun', 'devicectl', 'device', 'process', 'launch', '--device', device,
                              '--terminate-existing', p['bundleId'], '--timeout', '60', '--json-output', str(launch_json)], timeout=80)
            if json.loads(launch_json.read_text()).get('info', {}).get('outcome') != 'success':
                raise RuntimeError('设备启动未返回成功')
            self.state['launched'] = True
        self.log('任务完成')
        self.update('succeeded', finishedAt=time.time())

    def run(self):
        with (BASE / 'worker.lock').open('a') as lock:
            try:
                self.update('queued')
                self.log('等待 Mac 构建队列')
                while True:
                    self.check_cancel()
                    try:
                        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                        break
                    except BlockingIOError:
                        time.sleep(0.5)
                if self.keychain_password:
                    self.log('在本次构建会话中解锁签名钥匙串')
                    try:
                        r = subprocess.run(['security', 'unlock-keychain', '-p', self.keychain_password,
                                            str(pathlib.Path.home() / 'Library/Keychains/login.keychain-db')],
                                           capture_output=True, text=True, timeout=20)
                    except Exception:
                        raise RuntimeError('签名钥匙串解锁未完成，请检查 Mac 状态。') from None
                    finally:
                        self.keychain_password = ''
                    if r.returncode:
                        raise RuntimeError('登录钥匙串解锁失败，请检查本次输入的 Mac 钥匙串密码。')
                self.execute()
            except Cancelled:
                self.log('任务已取消')
                self.update('cancelled', finishedAt=time.time())
            except Exception as e:
                self.log('失败：' + str(e))
                sys.stdout.flush()
                detail = str(e)
                with contextlib.suppress(Exception):
                    lines = (self.directory / 'build.log').read_text(errors='replace').splitlines()
                    errors = [line.strip() for line in lines if ': error:' in line or line.startswith('ERROR:')]
                    if errors:
                        detail = '\n'.join(errors[-4:])[-4000:]
                self.update('failed', error=detail, finishedAt=time.time())
                traceback.print_exc()
            finally:
                fcntl.flock(lock, fcntl.LOCK_UN)


def main():
    BASE.mkdir(parents=True, exist_ok=True)
    action = sys.argv[1]
    if action == 'health':
        return health()
    directory = job_dir(sys.argv[2])
    if action == 'prepare':
        directory.mkdir(parents=True, exist_ok=False)
        request = json.load(sys.stdin)
        if request['action'] not in ('build', 'build-install', 'install'):
            raise ValueError('Unsupported action')
        write_json(directory / 'request.json', request)
        write_json(directory / 'status.json', {'status': 'preparing', 'updatedAt': time.time()})
        return {'ok': True}
    if action == 'start':
        password = sys.stdin.read(4096)
        if (directory / 'pid').exists():
            return {'ok': True, 'alreadyStarted': True}
        with (directory / 'build.log').open('a') as log:
            child = subprocess.Popen([sys.executable, '-u', __file__, 'run', sys.argv[2]],
                                     stdin=subprocess.PIPE, stdout=log, stderr=log, start_new_session=True)
        child.stdin.write(password.encode('utf-8'))
        child.stdin.close()
        password = ''
        (directory / 'pid').write_text(str(child.pid))
        return {'ok': True, 'pid': child.pid}
    if action == 'run':
        Worker(sys.argv[2]).run()
        return {'ok': True}
    if action == 'cancel':
        (directory / 'cancel').touch()
        return {'ok': True}
    if action == 'poll':
        state = json.loads((directory / 'status.json').read_text())
        if state.get('status') in ACTIVE and (directory / 'pid').exists():
            pid = int((directory / 'pid').read_text())
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                state.update(status='failed', error='Mac 构建进程已退出，请重试。', finishedAt=time.time())
                write_json(directory / 'status.json', state)
        offset = max(0, int(sys.argv[3])) if len(sys.argv) > 3 else 0
        log = directory / 'build.log'
        text = ''
        if log.exists():
            with log.open('rb') as f:
                f.seek(offset)
                data = f.read(65536)
                # Leave incomplete UTF-8 bytes for the next poll.
                for trim in range(4):
                    try:
                        text = (data[:-trim] if trim else data).decode('utf-8')
                        offset += len(data) - trim
                        break
                    except UnicodeDecodeError:
                        if trim == 3:
                            text = data.decode('utf-8', errors='replace')
                            offset += len(data)
                more = offset < log.stat().st_size
        else:
            more = False
        return {'state': state, 'log': text, 'offset': offset, 'more': more}
    raise ValueError('Unknown action')


if __name__ == '__main__':
    print(json.dumps(main(), ensure_ascii=False))
