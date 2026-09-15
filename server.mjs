import http from 'node:http';
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {SshClient} from './lib/ssh.mjs';
import {loadSettings,validateSettings,connectionKey} from './lib/settings.mjs';
import {validateProject,validId,snapshot,atomicJson} from './lib/core.mjs';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const DATA=path.resolve(process.env.ORCHARD_DATA_DIR||path.join(ROOT,'data')), JOBS=path.join(DATA,'jobs');
await fs.mkdir(JOBS,{recursive:true});
let config=await loadSettings(DATA,path.join(ROOT,'config.example.json'));
if(process.env.ORCHARD_PORT!==undefined)config=validateSettings({...config,port:Number(process.env.ORCHARD_PORT)});
const transport=()=>new SshClient(config.sshHost,config.sshConfigFile);
let ssh=transport();
const signingPasswords=new Map();
let resolveReady,rejectReady;
export const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
export const activity=()=>jobs.some(j=>!terminal.has(j.status));
const token=randomBytes(32).toString('hex');
let jobs=[],active=null,processing=false,healthCache=null,healthPending=null,workerReady=false;
const terminal=new Set(['succeeded','failed','cancelled','interrupted']);
const REMOTE='.local/share/orchard-relay';
const workerCommand='/usr/bin/python3 "$HOME/.local/share/orchard-relay/runner.py"';
for(const name of await fs.readdir(JOBS)) {
  if(!validId(name))continue;
  try{const j=JSON.parse(await fs.readFile(path.join(JOBS,name,'job.json'),'utf8'));jobs.push(j);}catch{}
}
jobs.sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const jobPath=j=>path.join(JOBS,j.id);
async function save(j){j.updatedAt=new Date().toISOString();await atomicJson(path.join(jobPath(j),'job.json'),j);}
async function log(j,s){await fs.appendFile(path.join(jobPath(j),'build.log'),s.endsWith('\n')?s:s+'\n');}
function publicJob(j){const {project,...rest}=j;return {...rest,configuration:project?.configuration};}
function errorText(e){return String(e?.message||e).slice(-12000);}
async function ensureWorker() {
  if(workerReady)return;
  await ssh.ssh(null,'mkdir -p "$HOME/.local/share/orchard-relay/jobs"');
  await ssh.call('ssh_upload',{localPath:path.join(ROOT,'mac','runner.py'),remotePath:REMOTE+'/runner.py',timeoutSeconds:60},80000);
  workerReady=true;
}
async function remote(action,id='',stdin=null,extra='') {
  if(id&&!validId(id))throw new Error('无效任务 ID');
  const raw=await ssh.ssh(null,workerCommand+' '+action+(id?' '+id:'')+(extra?' '+extra:''),stdin,60);
  try{return JSON.parse(raw);}catch{throw new Error('Mac 返回结果无法解析：'+raw.slice(-2000));}
}
async function startRemote(j){
  const args={command:workerCommand+' start '+j.id,stdin:signingPasswords.get(j.id)||'',timeoutSeconds:45};
  const r=await ssh.call('ssh_run',args,65000);
  if(r.exitCode!==0)throw new Error(r.stderr||r.stdout||'无法启动远程构建');
  const result=JSON.parse(r.stdout);signingPasswords.delete(j.id);return result;
}
async function getHealth() {
  if(healthPending)return healthPending;
  healthPending=(async()=>{
    try{await ensureWorker();const h=await remote('health');healthCache={...h,ok:true};}
    catch(e){healthCache={ok:false,error:errorText(e),checkedAt:Date.now()/1000,devices:[]};workerReady=false;}
    return healthCache;
  })().finally(()=>healthPending=null);
  return healthPending;
}
async function cancelled(j) {
  if(j.cancelRequested) {j.status='cancelled';await save(j);throw Object.assign(new Error('任务已取消'),{cancelled:true});}
}
async function prepare(j) {
  await cancelled(j);j.status='syncing';await save(j);
  let snap;
  if(j.action!=='install'){
    await log(j,'创建 Windows 源码快照（包含已保存的未提交修改）');
    const messages=[];
    snap=await snapshot(j.project,jobPath(j),m=>messages.push(m));
    for(const m of messages)await log(j,m);
    j.source=snap.source;await save(j);await cancelled(j);
  }else await log(j,'准备安装已构建的版本：'+j.sourceJobId);
  await ensureWorker();
  await remote('prepare',j.id,JSON.stringify({project:j.project,action:j.action,deviceId:j.deviceId,source:j.source,sourceJobId:j.sourceJobId}));
  j.remotePrepared=true;await save(j);
  if(snap){
    await log(j,'通过 SSH 上传源码到 '+config.sshHost);
    await ssh.call('ssh_upload',{localPath:snap.archive,remotePath:`${REMOTE}/jobs/${j.id}/source.tar.gz`,timeoutSeconds:300},320000);
  }
  await cancelled(j);
  if(signingPasswords.has(j.id))await log(j,'为本次构建临时解锁签名钥匙串');
  j.launchRequested=true;await save(j);
  await startRemote(j);
  j.remoteStarted=true;j.status='preparing';await save(j);
}
async function collectArtifact(j) {
  if(!j.remoteState?.artifact||j.artifact)return;
  try{
    if(j.connectionKey!==connectionKey(config))throw new Error('请切换回本次构建所用的 Mac 连接后再下载。');
    const name=j.projectId+'-'+j.id.slice(0,8)+'.app.zip';
    await ssh.call('ssh_download',{remotePath:`${REMOTE}/jobs/${j.id}/app.zip`,localPath:path.join(jobPath(j),name),timeoutSeconds:300},320000);
    j.artifact=name;await log(j,'构建产物已保存到本机：'+name);
  }catch(e){j.artifactError=errorText(e);await log(j,'产物下载未完成，仍可在 Mac 上找到本次 app.zip：'+j.artifactError);}
}
async function monitor(j) {
  let errors=0;
  while(true) {
    try {
      if(j.cancelRequested&&!j.cancelSent){await remote('cancel',j.id);j.cancelSent=true;}
      const p=await remote('poll',j.id,null,String(j.logOffset||0));
      if(p.log)await log(j,p.log);
      j.logOffset=p.offset;j.remoteState=p.state;j.status=p.state.status;j.connectionError=null;errors=0;
      if(p.state.error)j.error=p.state.error;
      await save(j);
      if(terminal.has(j.status)&&!p.more){await collectArtifact(j);j.finishedAt=new Date().toISOString();await save(j);break;}
      await sleep(p.more?250:2500);
    }catch(e){
      errors++;j.connectionError=errorText(e);await save(j);
      if(errors===1)await log(j,'暂时无法读取 Mac 状态，自动重连中：'+j.connectionError);
      await sleep(Math.min(30000,3000*errors));
    }
  }
}
async function processQueue() {
  if(processing)return;processing=true;
  try {
    while(true){
      const j=jobs.find(x=>!terminal.has(x.status));if(!j)break;active=j.id;
      try{
        if(j.launchRequested&&!j.remoteStarted){await ensureWorker();await startRemote(j);j.remoteStarted=true;await save(j);}
        if(!j.remoteStarted)await prepare(j);
        await monitor(j);
      }catch(e){
        // A start response may be lost while the detached process is alive.
        if(j.launchRequested&&!e.cancelled){j.connectionError=errorText(e);await save(j);await sleep(5000);continue;}
        signingPasswords.delete(j.id);j.status=e.cancelled?'cancelled':'failed';j.error=errorText(e);j.finishedAt=new Date().toISOString();
        await log(j,j.error);await save(j);
      }
    }
  }finally{active=null;processing=false;}
}

// Recover detached Mac jobs after the Windows window/service was closed.
for(const j of jobs){
  if(!terminal.has(j.status)&&!j.launchRequested&&j.status!=='queued'){
    j.status='interrupted';j.error='源码上传阶段被中断，请重新构建。';await save(j);
  }
}
async function body(req){
  let data='';for await(const b of req){data+=b;if(Buffer.byteLength(data)>65536)throw new Error('请求过大');}
  return JSON.parse(data||'{}');
}
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
function authorized(req){const v=req.headers['x-orchard-token'];if(typeof v!=='string')return false;const bytes=Buffer.from(v);return bytes.length===Buffer.byteLength(token)&&timingSafeEqual(bytes,Buffer.from(token));}
const server=http.createServer(async(req,res)=>{
  const origin=`http://127.0.0.1:${config.port}`;
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if(req.headers.host!==`127.0.0.1:${config.port}` || (req.headers.origin&&req.headers.origin!==origin))return json(res,403,{error:'不允许跨站访问'});
  const u=new URL(req.url,origin);
  try {
    if(u.pathname==='/ping'&&req.method==='GET')return json(res,200,{app:'OrchardRelay',version:'0.1.0'});
    if(u.pathname.startsWith('/api/')){
      if(!authorized(req))return json(res,401,{error:'请从 OrchardRelay.exe 重新打开窗口。'});
      if(u.pathname==='/api/state'&&req.method==='GET')return json(res,200,{config,health:healthCache,jobs:jobs.slice(-100).reverse().map(publicJob),active});
      if(u.pathname==='/api/health'&&req.method==='POST')return json(res,200,await getHealth());
      if(u.pathname==='/api/projects'&&req.method==='POST'){
        if(processing||jobs.some(j=>!terminal.has(j.status)))throw new Error('请等待当前构建队列结束，再编辑项目。');
        const p=validateProject(await body(req));await fs.access(path.join(p.localRoot,p.projectPath));
        const index=config.projects.findIndex(x=>x.id===p.id);
        if(index<0)config.projects.push(p);else config.projects[index]=p;
        await atomicJson(path.join(DATA,'config.json'),config);return json(res,200,{ok:true});
      }
      if(u.pathname==='/api/settings'&&req.method==='POST'){
        if(processing||jobs.some(j=>!terminal.has(j.status)))throw new Error('请等待构建队列结束后修改 SSH 设置。');
        const p=await body(req);
        const next=validateSettings({...config,sshHost:p.sshHost,sshConfigFile:p.sshConfigFile});
        if(!next.sshHost)throw new Error('请填写 SSH 主机别名');
        if(next.sshConfigFile)await fs.access(next.sshConfigFile);
        await atomicJson(path.join(DATA,'config.json'),next);config=next;ssh.close();ssh=transport();workerReady=false;healthCache=null;
        return json(res,200,{ok:true});
      }
      if(u.pathname==='/api/jobs'&&req.method==='POST'){
        const b=await body(req),p=config.projects.find(x=>x.id===b.projectId);
        if(!p)throw new Error('项目不存在');if(!['build','build-install','install'].includes(b.action))throw new Error('构建动作无效');
        if(b.action!=='build'&&(!b.deviceId||typeof b.deviceId!=='string'||b.deviceId.length>100))throw new Error('请选择连接到 Mac 的设备');
        if(jobs.filter(j=>!terminal.has(j.status)).length>=10)throw new Error('构建队列已满，请等待。');
        const prior=b.action==='install'?jobs.find(j=>j.id===b.sourceJobId&&j.projectId===p.id&&terminal.has(j.status)&&j.remoteState?.artifact):null;
        if(b.action==='install'&&!prior)throw new Error('找不到该项目已完成的签名构建');
        if(prior&&prior.connectionKey!==connectionKey(config))throw new Error('请切换回原来的 Mac 连接再安装此版本。');
        const project=prior?prior.project:{...p,configuration:b.configuration||p.configuration};validateProject(project);
        if(b.keychainPassword!==undefined&&(typeof b.keychainPassword!=='string'||b.keychainPassword.length>1024))throw new Error('Invalid keychain password');
        const j={id:randomUUID(),projectId:p.id,projectName:p.name,project,action:b.action,deviceId:b.deviceId||'',status:'queued',createdAt:new Date().toISOString(),connectionKey:connectionKey(config)};
        if(prior){j.sourceJobId=prior.id;j.source=prior.source;}
        await fs.mkdir(jobPath(j));await save(j);await log(j,'已加入构建队列');if(b.keychainPassword)signingPasswords.set(j.id,b.keychainPassword);jobs.push(j);void processQueue();return json(res,201,publicJob(j));
      }
      const match=u.pathname.match(/^\/api\/jobs\/([a-z0-9-]+)\/(log|cancel|artifact|download)$/);
      if(match){
        const j=jobs.find(x=>x.id===match[1]);if(!j)return json(res,404,{error:'任务不存在'});
        if(match[2]==='cancel'&&req.method==='POST'){
          if(!terminal.has(j.status)){j.cancelRequested=true;if(j.status==='queued'&&!j.remoteStarted){j.status='cancelled';signingPasswords.delete(j.id);}await save(j);}
          return json(res,200,{ok:true});
        }
        if(match[2]==='log'&&req.method==='GET'){
          const f=await fs.open(path.join(jobPath(j),'build.log'),'r');
          try{const stat=await f.stat(),full=u.searchParams.get('full')==='1',size=full?stat.size:Math.min(stat.size,180000),buf=Buffer.alloc(size);await f.read(buf,0,size,stat.size-size);res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});return res.end(buf);}finally{await f.close();}
        }
        if(match[2]==='download'&&req.method==='POST'){
          if(!terminal.has(j.status))throw new Error('请等待构建结束');await collectArtifact(j);await save(j);return json(res,200,publicJob(j));
        }
        if(match[2]==='artifact'&&req.method==='GET'&&j.artifact){
          const artifactPath=path.join(jobPath(j),path.basename(j.artifact)),stat=await fs.stat(artifactPath);
          res.writeHead(200,{'Content-Type':'application/zip','Content-Length':stat.size,'Content-Disposition':`attachment; filename="${path.basename(j.artifact)}"`});
          const stream=createReadStream(artifactPath);res.once('close',()=>stream.destroy());stream.once('error',()=>res.destroy());stream.pipe(res);return;
        }
      }
      return json(res,404,{error:'接口不存在'});
    }
    if(req.method!=='GET')return json(res,405,{error:'Method not allowed'});
    const files={'/':'index.html','/app.js':'app.js','/styles.css':'styles.css','/icon.svg':'icon.svg'};
    const file=files[u.pathname];if(!file)return json(res,404,{error:'Not found'});
    res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'image/svg+xml','Cache-Control':'no-store'});
    res.end(await fs.readFile(path.join(ROOT,'public',file)));
  }catch(e){if(!res.headersSent)json(res,400,{error:errorText(e)});else res.end();}
});

server.on('error',async e=>{
  ssh.close();rejectReady(e);
});
server.listen(config.port,'127.0.0.1',async()=>{
  config.port=server.address().port;
  const url=`http://127.0.0.1:${config.port}/#${token}`;
  await atomicJson(path.join(DATA,'runtime.json'),{pid:process.pid,url,startedAt:new Date().toISOString()});
  console.log(`OrchardRelay listening on http://127.0.0.1:${config.port}`);
  resolveReady({url,port:config.port,dataDirectory:DATA});
  void processQueue();
});
export function shutdown(){signingPasswords.clear();ssh.close();server.closeAllConnections();server.close();}
process.on('SIGINT',()=>{shutdown();process.exit(0);});process.on('SIGTERM',()=>{shutdown();process.exit(0);});
if(!process.versions.electron)ready.catch(e=>{console.error(e.message);process.exit(1);});
