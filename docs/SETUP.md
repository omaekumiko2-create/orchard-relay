# SSH setup

**English** · [简体中文](SETUP.zh-CN.md)

## 1. Prepare the Mac

Enable **System Settings → General → Sharing → Remote Login** for the intended build user. Install Xcode and its command-line tools, finish Xcode's first-run setup, and sign in to the Apple developer team that owns your app identifier.

Verify on the Mac:

```sh
xcodebuild -version
xcrun devicectl list devices
python3 --version
```

Connect the iPhone to this Mac, accept pairing/trust, enable Developer Mode if prompted, and keep it unlocked during installation. Start with a successful signed build in Xcode to establish the team's signing setup.

## 2. Configure Windows SSH

Use an existing SSH identity or generate a dedicated key using OpenSSH. Keep the private key on your Windows computer; install only its public key in the Mac user's `~/.ssh/authorized_keys`. Use a passphrase and a running SSH agent where appropriate. An existing key/agent setup is supported.

Example `%USERPROFILE%/.ssh/config` entry (replace every placeholder):

```sshconfig
Host build-mac
  HostName mac-address-or-hostname
  User mac-build-user
  IdentityFile ~/.ssh/id_ed25519
  IdentitiesOnly yes
```

On the Mac, inspect the host fingerprint:

```sh
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

Connect from Windows with `ssh build-mac`, compare the fingerprint, and accept it only when it matches. Orchard Relay always uses strict host checking and will not accept unknown host keys automatically.

Verify unattended access before opening the app:

```sh
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes build-mac xcodebuild -version
sftp build-mac
```

Quit the SFTP prompt with `bye`. If your setup uses a custom SSH config, add `-F "C:/path/to/config"` to both commands and enter that path in Orchard Relay's connection settings.

## 3. Add a project

Example fields:

| Field | Example |
|---|---|
| Project name / 项目名称 | Sample Notes |
| Project ID / 项目 ID | sample-notes |
| Windows source / Windows 源码目录 | `C:\Dev\SampleNotes` |
| Mac original repository / Mac 原仓库目录 | `~/Projects/SampleNotes` |
| Xcode project / Xcode 工程路径 | `ios/SampleNotes.xcodeproj` |
| Scheme | `SampleNotes` |
| Bundle ID | `com.example.samplenotes` |
| Team ID | Your own 10-character Apple Team ID, or blank to use the project setting |
| Source directories / 同步目录 | `ios` |
| Local Mac configs / 复用的 Mac 本地 .xcconfig | `ios/SampleNotes/Config.local.xcconfig`, if needed |

The original Mac directory must exist. If no existing repository is needed for local configuration, create an empty directory and leave the local config list empty. Orchard Relay uploads source into a separate build copy, not this directory.

The source root must be a Git repository with at least one commit. Files outside the configured directories, ignored files, symbolic links, and Git submodules are not synchronized. Add every directory referenced by the Xcode project, such as shared fixtures.

## 4. Build and sign

Choose Debug/Release and click Build only or Build and install. Both are development/device build workflows.

If the signing keychain is locked, optionally enter its password under **本次构建的签名钥匙串** before enqueuing a new build. It is passed through the encrypted SSH connection to the detached worker's standard input, and used to unlock the login keychain in that worker's security session. It is not an SSH login password and is not saved for later builds.

This does not change signing-key access control. If macOS still requires a signing prompt, configure the specific signing key's access for Apple's signing tools on the Mac. Profile capability errors require fixing the App ID/provisioning profile in your developer account.

## Troubleshooting

| Symptom | Check |
|---|---|
| `ssh` / `sftp` not found | Install Windows OpenSSH Client and restart the app |
| Permission denied | SSH key, agent, Mac username, and authorized public key |
| Host key verification failed | Verify the Mac's fingerprint through a trusted channel and update your known-hosts entry |
| Xcode or Python unavailable | Mac first-run setup and active developer directory |
| Device not available | USB connection, trust, Developer Mode, and unlock state |
| No provisioning profile | App ID ownership, selected team, and enabled capabilities |
| `errSecInternalComponent` | Keychain unlock and the signing private key's access settings |
| Artifact install fails after connection change | Switch back to the original SSH alias/config |

Do not disable host-key verification to work around an error.
