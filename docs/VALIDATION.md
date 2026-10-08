# v0.1.0 validation

**English** · [简体中文](VALIDATION.zh-CN.md)

Local verification on 2026-09-16:

- Windows: eight automated checks passed for source snapshots, path validation, atomic persistence, SSH argument validation, configuration isolation, and HTTP authentication/Host/Origin enforcement.
- macOS: two worker checks passed for archive path traversal rejection and cancellation of a running child process group.
- Two existing native iOS projects completed source upload, device build, code signing, artifact download, USB installation, and device launch through the packaged desktop backend and standard OpenSSH/SFTP.
- Device integration used macOS 26.3.1, Xcode 26.6, and an iPhone running iOS 26.3.

These checks cover a local setup, not every signing team, Xcode version, project generator, or network environment. Active-job recovery after an abrupt desktop process termination was not exercised. App Store/TestFlight submission is outside this release's scope.

CI repeats the Node checks on Windows and macOS, the worker checks on macOS, and builds the Windows installer. It does not have a physical iPhone or an Apple signing identity.
