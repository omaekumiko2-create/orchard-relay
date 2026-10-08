# Security

**English** · [简体中文](SECURITY.zh-CN.md)

Orchard Relay assumes that the Windows user, the Mac SSH account, and the Xcode project being built are trusted. Xcode projects can execute build scripts. Do not build untrusted repositories with access to your signing identity.

The desktop renderer has no Node.js integration, runs in a sandbox, and cannot navigate to external origins. The loopback API requires a random session token and validates Host and Origin. This is not an isolation boundary against other programs running as your Windows user.

SSH/SFTP use the system OpenSSH client with batch authentication and strict host-key checking. Private keys and SSH agent access remain managed by OpenSSH. The app does not collect SSH login passwords or bypass host verification.

An optional one-build Mac login-keychain password is held in process memory, sent via SSH standard input, and forwarded to the detached worker through an anonymous pipe. It is not persisted in job request files, configuration, source snapshots, or logs. It cannot protect against a compromised Windows or Mac user session or privileged process inspection. After a process restart it must be re-entered if a build has not yet started.

Snapshot exclusions catch common private/configuration files, not every possible secret. Inspect your configured source directories and Git ignore rules before building. Local history contains private project paths, source snapshots, and build artifacts.

For suspected vulnerabilities, use the repository's private security reporting feature if available. Do not publish secrets, private source, device IDs, or live session URLs in an issue. There is no promised response-time SLA for this community project.

Release binaries are currently unsigned. Verify their source and published SHA-256 checksum. Updates are installed manually.
