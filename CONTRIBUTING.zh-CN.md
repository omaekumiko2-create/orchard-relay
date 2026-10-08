# 参与贡献

[English](CONTRIBUTING.md) · **简体中文**

1. 先提交 issue，描述问题或计划中的改动。示例使用合成数据，日志中移除私有路径和标识。
2. 安装 Node.js 22+，然后运行 `npm ci` 和 `npm test`。
3. 使用 `npm start` 启动桌面应用。本地开发状态保存在应用数据目录，绝不得提交。
4. 修改 worker 后，在 macOS/Linux 运行 `python3 -m unittest discover -s tests -p '*_test.py'`；适用时，在 Mac 上验证受影响的构建/安装行为。
5. 修改 Windows 打包逻辑后，运行 `npm run dist`，验证全新安装及已有设置。

不得提交运行时配置、SSH 密钥、签名凭据、日志或应用源码快照。优先进行小范围改动，并为失败处理和边界验证提供有意义的测试。

应用当前使用简体中文界面，欢迎贡献英文界面本地化；保留技术标识和构建日志内容不变。

贡献内容按本项目的 MIT 许可证授权。
