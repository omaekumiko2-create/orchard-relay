# Orchard Relay

<img src="public/icon.png" alt="Orchard Relay" width="88">

**在 Mac 构建 iOS 应用，继续使用 Windows。**

这是一个 Windows 桌面应用，可通过 SSH 将已保存的 Xcode 工程源码发送到 Mac，使用 Xcode 构建和签名，并安装到连接在该 Mac 上的 iPhone。

[English](README.md) | [简体中文](README.zh-CN.md) · [下载 Windows 安装程序](https://github.com/omaekumiko2-create/orchard-relay/releases/latest) · [设置](docs/SETUP.zh-CN.md)

## 功能

- 独立桌面窗口、桌面快捷方式和系统托盘。安装程序包含运行时，无需安装 Node.js 即可运行。
- 仅使用标准 OpenSSH 和 SFTP，支持 SSH 主机别名及现有 SSH 密钥/agent。
- 多个原生 Xcode 工程和工作区、Debug/Release 构建，以及可选的团队覆盖设置。
- 源码快照包含已保存的未提交修改和未被忽略的新文件，并附 SHA-256 清单。
- 串行构建队列、实时日志、取消、重试，以及重新连接独立运行的 Mac 任务。
- 仅构建、构建并安装，或安装此前构建的版本。
- 下载已签名的 `.app.zip` 产物和完整日志。
- 可为一次排队构建提供签名钥匙串密码；密码仅临时保存在内存中并通过 SSH 传递，绝不写入配置、任务文件或日志。

v0.1 界面为简体中文；提供英文和中文设置指南。

## 快速开始

1. 从 [Releases](https://github.com/omaekumiko2-create/orchard-relay/releases) 下载 `OrchardRelay-Setup-0.1.0.exe`。
2. 安装后，从桌面打开 **Orchard Relay**。
3. 配置 `build-mac` 等 SSH 别名，并在终端验证密钥认证。参见[设置指南](docs/SETUP.zh-CN.md)。
4. 在**连接设置**中填写该别名，也支持可选的自定义 SSH 配置路径。
5. 在**添加项目**中填写 Windows 仓库、Mac 配置目录、Xcode 工程/工作区、scheme、bundle ID 和源码目录。
6. 将 iPhone 连接至 Mac 并解锁。点击**检查连接**，再点击**编译并安装到手机**。

点击**仅编译**可在没有手机时构建；在已完成构建中点击**安装此版本**可安装其现有产物。

关闭窗口会将应用收起到系统托盘，让队列继续处理。双击桌面图标会打开已有窗口。使用托盘菜单完全退出。完全退出后，已启动的 Mac 任务继续运行；若源码传输在远端启动前被中断，则需要重试。

## 要求

| Windows | Mac |
|---|---|
| Windows 10/11 x64 | Xcode、所需 iOS SDK 和命令行工具 |
| PATH 中可用的 Git、OpenSSH（`ssh`、`sftp`）和 `tar` | 已开启远程登录并配置 SSH 密钥认证 |
| 含可直接构建 Xcode 工程的本地 Git 仓库 | Python 3、可用签名身份和开发描述文件 |
| 可通过网络访问 Mac | 安装时，iPhone 已配对、信任、解锁并开启开发者模式 |

不包含云构建服务或 Apple 账户凭据。签名及描述文件由 Mac 上的 Xcode 管理，仍然需要 Mac。

## 签名与安装说明

先在 Mac 上准备开发者账号、证书和与 Bundle ID 对应的描述文件。允许 Xcode 自动更新描述文件不能替代开发者账号权限。

若 SSH 构建无法访问登录钥匙串，可展开**本次构建的签名钥匙串**并输入密码。它只用于下一次新构建，绝不写入配置、历史或日志，启动任务后清除内存中的引用。SSH 登录仍使用 SSH 密钥，不使用这里填写的密码。若签名私钥要求交互确认，需要在 Mac 钥匙串中为对应签名工具配置访问权限。不要将证书或私钥上传至本仓库。

Mac 原仓库作为本地配置来源，构建使用独立副本。安装操作不会主动卸载应用；改变 Bundle ID 会安装成另一款应用，旧数据不会自动迁移。

## 数据与安全

- 桌面应用将设置和历史保存在 `%APPDATA%/Orchard Relay`，独立于应用文件和更新。卸载默认保留用户数据。
- 源码开发服务器默认使用 `data/`，可通过 `ORCHARD_DATA_DIR` 覆盖。
- Mac 工作目录是 `~/.local/share/orchard-relay/`；构建 worker 不会覆盖原仓库。
- 快照排除 `.env` 文件、签名密钥、描述文件、Xcode 用户状态及已配置的本地 `.xcconfig` 文件，包括 `Secrets.xcconfig` 和 `Config.local.xcconfig`。请检查同步目录：普通源码中嵌入的任意秘密无法自动检测。
- 强制进行 SSH 主机密钥检查。不收集 SSH 登录密码，请先配置密钥或 agent。
- 桌面应用的 UI 服务绑定本机回环地址上的随机端口。API 调用要求随机会话令牌，并通过 Host/Origin 检查。渲染器启用沙箱并禁用 Node 集成。
- 无分析追踪、远程遥测或自动更新。本地设置、任务、密钥和应用源码快照不属于本仓库或发布包。

信任模型和报告指南参见[安全说明](SECURITY.zh-CN.md)。

## v0.1 范围

此版本构建可直接构建的原生 Xcode 工程。它不安装 CocoaPods/Flutter/React Native 依赖，也不运行工程生成命令。请在使用前准备这些依赖。

产物是用于已连接设备、带开发签名的 `.app.zip`。尚未实现 App Store/TestFlight 归档、导出和上传。这里的 `Release` 构建仍使用连接设备构建流程。

一次仅有一个活动 Mac 连接，队列活动期间不能更改连接。访问历史远端产物需要切回原连接。构建缓存和历史会一直保留，直到空闲时明确归档或移除。

Windows 安装程序目前没有代码签名。请确认它来自本仓库的 Releases，并将 SHA-256 与 `SHA256SUMS.txt` 比较。Windows 可能显示未知发布者提示。

## 开发

源码开发使用 Node.js 22 或更新版本：

```sh
npm ci
npm test
npm start
```

构建 Windows 安装程序：

```sh
npm run dist
```

在 macOS 或 Linux 上运行 worker 测试：

```sh
python3 -m unittest discover -s tests -p '*_test.py'
```

核心后端使用 Node 标准库，Mac worker 使用 Python 标准库，Electron 提供桌面外壳。依赖版本固定在 `package-lock.json` 中。

浏览器开发会话运行 `npm run server`，然后打开 `data/runtime.json` 记录的 URL。不要分享该本地会话 URL。

## 贡献

参见[贡献指南](CONTRIBUTING.zh-CN.md)。欢迎修复错误、提供英文 UI 本地化，以及改进签名诊断。Issue 中请使用虚构工程名，并移除主机名、设备标识符、凭据和私有源码。

## 许可证

[MIT](LICENSE)。Electron 及其捆绑组件保留各自许可证，随 Windows 发行包提供。
