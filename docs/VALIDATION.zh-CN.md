# v0.1.0 验证

[English](VALIDATION.md) · **简体中文**

2026-09-16 的本地验证结果：

- Windows：八项自动检查通过，覆盖源码快照、路径校验、原子持久化、SSH 参数校验、配置隔离，以及 HTTP 认证/Host/Origin 约束。
- macOS：两项 worker 检查通过，覆盖压缩包路径穿越拒绝和运行中子进程组的取消。
- 两个已有原生 iOS 工程通过打包后的桌面后端及标准 OpenSSH/SFTP，完成源码上传、设备构建、代码签名、产物下载、USB 安装和设备启动。
- 设备集成使用 macOS 26.3.1、Xcode 26.6，以及运行 iOS 26.3 的 iPhone。

这些检查覆盖一套本地环境，不代表覆盖所有签名团队、Xcode 版本、工程生成器或网络环境。未验证桌面进程突然终止后的活动任务恢复。App Store/TestFlight 提交不在本次发行范围内。

CI 会在 Windows/macOS 重复 Node 检查，在 macOS 运行 worker 检查，并构建 Windows 安装程序。CI 不具备实体 iPhone 或 Apple 签名身份。
