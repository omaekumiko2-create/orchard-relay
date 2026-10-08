# SSH 配置

[English](SETUP.md) · **简体中文**

## 1. 准备 Mac

在 **系统设置 → 通用 → 共享 → 远程登录** 中为目标构建用户开启远程登录。安装 Xcode 及命令行工具，完成 Xcode 首次运行设置，并登录拥有应用标识的 Apple 开发团队。

在 Mac 上验证：

```sh
xcodebuild -version
xcrun devicectl list devices
python3 --version
```

把 iPhone 连接到此 Mac，接受配对/信任提示，按提示启用开发者模式，并在安装期间保持解锁。先在 Xcode 中成功完成一次签名构建，建立团队签名配置。

## 2. 配置 Windows SSH

使用已有 SSH 身份，或通过 OpenSSH 生成专用密钥。私钥保留在 Windows 电脑，仅将公钥安装到 Mac 用户的 `~/.ssh/authorized_keys`。适用时使用私钥口令和运行中的 SSH agent。已有密钥/agent 配置也受支持。

以下是 `%USERPROFILE%/.ssh/config` 示例；替换所有占位内容：

```sshconfig
Host build-mac
  HostName mac-address-or-hostname
  User mac-build-user
  IdentityFile ~/.ssh/id_ed25519
  IdentitiesOnly yes
```

在 Mac 上查看主机指纹：

```sh
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

从 Windows 运行 `ssh build-mac` 连接，比较指纹，只有一致时才接受。Orchard Relay 始终严格校验主机密钥，不会自动接受未知主机密钥。

打开应用前，先验证无人值守访问：

```sh
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes build-mac xcodebuild -version
sftp build-mac
```

在 SFTP 提示符输入 `bye` 退出。使用自定义 SSH 配置时，在两个命令中都加入 `-F "C:/path/to/config"`，并在 Orchard Relay 的连接设置填写该路径。

## 3. 添加项目

字段示例：

| 字段 | 示例 |
|---|---|
| Project name / 项目名称 | Sample Notes |
| Project ID / 项目 ID | sample-notes |
| Windows source / Windows 源码目录 | `C:\Dev\SampleNotes` |
| Mac original repository / Mac 原仓库目录 | `~/Projects/SampleNotes` |
| Xcode project / Xcode 工程路径 | `ios/SampleNotes.xcodeproj` |
| Scheme | `SampleNotes` |
| Bundle ID | `com.example.samplenotes` |
| Team ID | 自己的 10 位 Apple Team ID，或留空以使用工程设置 |
| Source directories / 同步目录 | `ios` |
| Local Mac configs / 复用的 Mac 本地 .xcconfig | 按需填写 `ios/SampleNotes/Config.local.xcconfig` |

Mac 原目录必须存在。若无需复用已有仓库中的本地配置，可创建空目录并清空本地配置列表。Orchard Relay 把源码上传到独立构建副本，不会上传到此原目录。

源码根必须是至少有一次提交的 Git 仓库。配置目录外的文件、Git 忽略文件、符号链接和 Git 子模块均不同步。应加入 Xcode 工程引用的每个目录，例如共享夹具目录。

## 4. 构建与签名

选择 Debug/Release，点击 Build only（仅编译）或 Build and install（编译并安装）。二者都是开发/设备构建流程。

若签名钥匙串处于锁定状态，可在新构建入队之前，在 **本次构建的签名钥匙串** 下填写密码。密码经加密 SSH 连接传入脱离启动会话的 worker 标准输入，用于在该 worker 的安全会话中解锁登录钥匙串。这不是 SSH 登录密码，也不会保存供后续构建使用。

该操作不改变签名密钥的访问控制。若 macOS 仍弹出签名提示，需要在 Mac 上为指定签名密钥配置 Apple 签名工具的访问权限。描述文件能力错误需在开发者账户中修正 App ID/provisioning profile。

## 故障排查

| 现象 | 检查项 |
|---|---|
| 找不到 `ssh` / `sftp` | 安装 Windows OpenSSH Client 并重启应用 |
| Permission denied | SSH 密钥、agent、Mac 用户名和授权公钥 |
| Host key verification failed | 通过可信渠道核对 Mac 指纹，并更新 known-hosts 记录 |
| Xcode 或 Python 不可用 | Mac 首次运行设置及当前开发者目录 |
| 设备不可用 | USB 连接、信任、开发者模式和解锁状态 |
| 没有 provisioning profile | App ID 所属关系、所选团队和启用的 capabilities |
| `errSecInternalComponent` | 钥匙串解锁及签名私钥访问设置 |
| 修改连接后产物安装失败 | 切回原 SSH alias/config |

不得通过关闭主机密钥校验来绕过错误。
