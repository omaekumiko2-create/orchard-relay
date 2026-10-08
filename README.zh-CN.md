# Orchard Relay

**在 Windows 发起，在 Mac 编译。**

通过标准 SSH/SFTP，把 Windows 上保存的 iOS 源码交给 Mac 编译、签名，并安装到连接在 Mac 上的 iPhone。

[English](README.md) · [下载 Windows 安装程序](https://github.com/omaekumiko2-create/orchard-relay/releases/latest)

## 使用

1. 安装 Releases 中的 `OrchardRelay-Setup-0.1.0.exe`，桌面会出现 **Orchard Relay**。运行时已包含在安装包中，无需安装 Node.js。
2. Windows 需要 Git、OpenSSH（`ssh` 和 `sftp`）及 `tar`；Mac 需要 Xcode、Python 3、远程登录和可用签名。
3. 按 [SSH 配置指南](docs/SETUP.zh-CN.md) 配置密钥登录，先在终端确认主机指纹及免交互连接。
4. 打开「连接设置」，填写 SSH 主机别名；使用独立 SSH 配置文件时填写其绝对路径。
5. 点击「添加项目」，填写源码目录、工程相对路径、Scheme、Bundle ID、同步目录等。
6. 手机接在 Mac 上，解锁并信任 Mac，开启开发者模式。点击「检查连接」后开始构建。

支持「仅编译」「编译并安装」「安装此版本」、队列、实时日志、取消、重试与产物下载。添加更多项目不需要修改源码。

关闭窗口会收起到系统托盘，队列继续处理。双击桌面图标会打开已有窗口，托盘菜单中可完全退出。已经启动的 Mac 构建会独立运行；上传期间退出的任务可能需要重新构建。

## 签名

先在 Mac 上准备开发者账号、证书、与 Bundle ID 对应的描述文件。允许 Xcode 自动更新描述文件，不能替代开发者账号权限。

若 SSH 构建无法访问登录钥匙串，可展开「本次构建的签名钥匙串」并输入其密码。密码只用于下一次新构建，不写入配置、历史或日志；启动任务后清除内存中的引用。SSH 登录仍使用 SSH 密钥，不使用这里填写的密码。

若签名私钥要求交互确认，需要在 Mac 钥匙串中为相应签名工具配置访问权限。不要把证书或私钥上传到此仓库。

## 数据位置

- Windows 安装版：`%APPDATA%/Orchard Relay`。
- 源码开发版：项目中的 `data/`，可由 `ORCHARD_DATA_DIR` 覆盖。
- Mac：`~/.local/share/orchard-relay/`。

配置、SSH 密钥、构建历史和你的应用源码属于本机数据，不随开源代码或安装包发布。卸载默认保留用户数据。

同步包含已保存的未提交修改及未被 Git 忽略的新文件。`.env`、签名文件、Xcode 用户配置、`Secrets.xcconfig`、`Config.local.xcconfig` 等不会从 Windows 上传。普通源码里硬编码的密钥无法自动识别，请自行检查同步范围。

Mac 原仓库作为本地配置来源，构建使用独立副本。安装操作不会主动卸载应用；改变 Bundle ID 会安装成另一款应用，旧数据不会自动迁移。

## 当前边界

- 只提供 SSH 连接，支持一个活动 Mac 连接和多个项目。
- 面向可直接构建的原生 Xcode 工程/工作区；额外的依赖安装和工程生成需预先完成。
- 产物为开发签名的 `.app.zip`，暂不支持 App Store/TestFlight 归档上传。
- 当前安装包没有 Windows 代码签名，下载后可与 Release 的 `SHA256SUMS.txt` 核对。
- 历史与缓存不会自动清理。

开发命令和许可证见 [English README](README.md)；另见[贡献指南](CONTRIBUTING.zh-CN.md)、[安全说明](SECURITY.zh-CN.md)和[验证记录](docs/VALIDATION.zh-CN.md)。
