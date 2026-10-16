<h1 align="center">DSH Bash Guard</h1>
<p align="center"><strong>给 Agent 工作空间，把权限留在你手里。</strong></p>
<p align="center">4 个范围 × 3 种权限。12 个开关，一个原生菜单。</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-bash-guard"><img alt="npm version" src="https://img.shields.io/npm/v/dsh-bash-guard"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue"></a>
  <img alt="DSH Web plugin" src="https://img.shields.io/badge/DSH-Web_plugin-555">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-policy_classifier-3178C6?logo=typescript&logoColor=white">
  <img alt="Preview" src="https://img.shields.io/badge/status-preview-orange">
</p>

<p align="center">
  <a href="#快速开始">快速开始</a> ·
  <a href="#权限怎么读">权限模型</a> ·
  <a href="#安全边界">安全边界</a> ·
  <a href="#来源与致谢">来源与致谢</a>
</p>

**DSH Bash Guard 是 DeepSeek Harness 的独立 Web 插件。** 它把 Bash Agent / Bash Guard 的四位权限思路带进 DSH 原生权限菜单，让你按范围控制工具操作，而不必在“只读”和“全部放开”之间二选一。

不改宿主源码，不增加一排数字预设，也不用记斜杠命令。展开 `bash-guard 自定义`，直接调整系统、外部、网络和工作区的读、写、执行权限。

> **它是额外的工具权限检查，不是沙箱替代品。** 即使设为 `7777`，DSH 原生沙箱和审批仍然适用。

## 为什么使用它

- **权限看得见。** 四行三列，12 个独立开关，支持全部 4096 种组合。
- **原生菜单，不打断工作。** 保留原生权限选项、图标和风险确认；修改时菜单保持展开。
- **从单格到整行。** 点一个格子切换一个权限位；点 scope 名称全选或清空这一行。
- **配置随会话记住。** 同一 session ID 重开可恢复；切回原生预设停用 Guard，但保留上次数字。
- **有依据的拒绝。** 支持的操作按 `required` 与 `allowed` 比较，拒绝时说明所需权限位。

## 快速开始

### 从 npm 安装（推荐）

需要 DSH `0.2.0-rc.2` 或更新版本；兼容范围说明见下文。插件安装到 DSH 的 `web` profile，无需全局安装 npm 包，也无需克隆或手动构建。

```bash
dsh plugin --profile web add dsh-bash-guard
dsh --profile web
```

安装后重新启动对应的 DSH Web 实例，在权限菜单中选择 **bash-guard 自定义**。

[npm 包页面](https://www.npmjs.com/package/dsh-bash-guard) · 当前发布版本：`0.1.0`

升级到最新发布版本：

```bash
dsh plugin --profile web add dsh-bash-guard@latest
```

如果 npm 镜像尚未同步新版本，可以显式使用官方 registry：

```bash
dsh plugin --profile web add dsh-bash-guard@latest --registry=https://registry.npmjs.org
```

### 从源码安装（开发者）

需要 Git、Node.js / npm，以及上述版本的 DSH。

```bash
git clone https://github.com/lloydzhou/dsh-bash-guard.git
cd dsh-bash-guard
npm ci
npm run build

dsh plugin --profile web add .
dsh --profile web
```

在输入框附近打开权限菜单，选择 **bash-guard 自定义**。

目录安装采用链接。更新插件后重新构建；宿主入口或插件配置变化时，重启对应的 DSH 实例。

## 在菜单中操作

| 入口 | 行为 |
| :--- | :--- |
| 单个权限格 | 独立切换该范围的读、写或执行位 |
| 系统 / 外部 / 网络 / 工作区 | 已全选则清空该行，否则全选该行 |
| 全选 | 当前不是 `7777` 时显示，点击将全部 Guard 位设为 `7777` |
| 默认 | 当前是 `7777` 时显示，点击恢复 `0477` |
| 原生权限预设 | 停用 Guard，保留记忆的四位值 |

方向键在矩阵中移动焦点，不修改权限；空格切换当前按钮，Escape 关闭菜单。状态由服务端确认，保存时不插入提示行或改变菜单高度。

**当前默认值有两种用途：** 新会话的初始记忆值是 `0467`，且 Guard 默认不激活；菜单“默认”按钮的恢复值是 `0477`。已有会话不会因升级自动重置。

## 权限怎么读

借鉴 Unix `rwx` 位的表示法，但这是**工具操作策略**，不是文件系统的 `chmod` 权限。

```text
模式：       0       4       6       7
范围：     系统     外部     网络    工作区
           system  external network workspace

每位：读 = 4，写 = 2，执行 = 1
组合：按位相加，例如 6 = 4 + 2 = 读 + 写
```

| 数字 | 读 | 写 | 执行 |
| :---: | :---: | :---: | :---: |
| `0` | 否 | 否 | 否 |
| `1` | 否 | 否 | 是 |
| `2` | 否 | 是 | 否 |
| `3` | 否 | 是 | 是 |
| `4` | 是 | 否 | 否 |
| `5` | 是 | 否 | 是 |
| `6` | 是 | 是 | 否 |
| `7` | 是 | 是 | 是 |

### 四个范围

| Scope | 含义 |
| :--- | :--- |
| 系统 | 系统路径及敏感路径，例如 `/etc`、`/usr`、`.ssh`、凭据或密钥相关路径；敏感路径即使位于项目内，也可能归入系统范围 |
| 外部 | 工作区外、不属于系统范围的普通路径 |
| 网络 | 被分类器识别的网络读取、写入及远程执行操作 |
| 工作区 | 项目内文件与命令操作；分类器还将直接的可信临时路径纳入这一范围 |

路径分类是词法判断。`/tmp` 等可信路径的特殊规则、敏感名称规则和命令分类，见 [分类器源码](src/classify.ts)。这不是对实际文件系统归属的完整证明。

### 几个容易记住的组合

| 模式 | 表达的策略 |
| :---: | :--- |
| `0467` | 系统关闭；外部只读；网络读写；工作区全部 |
| `0477` | 与上项相比，增加网络执行位；菜单“默认”的恢复值 |
| `4447` | 系统、外部、网络只读；工作区全部 |
| `0007` | 仅开放工作区的三个权限位 |
| `7777` | Guard 全部位开放，**不等于原生完全权限** |

模式不是安全等级排序。请按需要开启具体位，不要仅因为数字更大而认为它更合适。

### 操作如何判定

```text
Agent 工具调用
    │
    ├─ Guard 未激活 / 工具未接管 ─────────► 原生工具路径
    │
    └─ Guard 已激活且支持该工具
         ├─ 累计需要的权限位 required
         ├─ 不满足 allowed ──────────────► BASH_GUARD_DENIED
         └─ 全部满足 ────────────────────► 原生工具、沙箱与审批
```

判定规则是 `(allowed & required) === required`，不是比较数字大小。复合命令会累计多个范围的要求，不会只取一个“最高”范围。

例如，同样执行 `cat /etc/hosts`：

- `0467` 缺少系统读取位，拒绝，`required=4000`。
- `4467` 满足 Guard 的系统读取要求，之后仍需通过原生执行路径。

这组场景已在实际 DSH Web 会话验证：前者被拒绝，后者在工具原始结果中返回文件内容。

当前分类器接管 `bash`，以及 `read`、`read_image`、`grep`、`glob`、`ls`、`write`、`edit` 等已识别工具名称。读取工具按目标路径检查读权限，写入工具检查写权限。未接管的工具继续走宿主原有策略。

## 安全边界

请在使用前了解这些限制：

- **不是不可绕过的隔离层。** 分类器是保守词法扫描器，不是完整 Bash AST，也无法证明任意脚本或程序的运行时行为。
- **不提高宿主权限。** 激活时选择原生 `workspace-write` 预设；Guard 放行不绕过底层沙箱和审批。该预设的具体行为由宿主配置决定。
- **不覆盖所有工具。** 未识别的工具不会自动被本插件拦截，仍依赖宿主策略。
- **不保证符号链接与动态路径隔离。** 实际文件系统、网络和子进程隔离仍由宿主负责。
- **不保证子代理继承。** 跨代理任务不能假定自动沿用父会话的 Guard 配置。
- **不是 Bash Guard Rust 运行时。** 本插件没有集成其 Jev 决策层、Claude/Codex Hook 或审计日志功能，也不宣称相同的安全保证。

需要报告问题？请附上脱敏后的命令、四位模式、预期与实际结果，在 [Issues](https://github.com/lloydzhou/dsh-bash-guard/issues) 中反馈。不要提交凭据或私有文件内容。

## 会话与兼容性

配置保存在 DSH 插件数据域 `bash_guard`，按 session ID 记录模式、激活状态和修订号。写入先持久化再确认；同会话写入串行，修订号防止过时编辑覆盖新状态。

这是插件侧存储，**不是原生会话 JSONL 的一部分**。导出、分叉和历史回退不会自动携带或回放配置。

客户端通过独立 RPC 读写，不使用命令轮询或额外会话写句柄。兼容基线为 DSH `0.2.0-rc.2`，不支持更早的宿主。服务端直接依赖官方 npm 包 `@deepseek-ai/dsh-typert-protocol@0.2.0-rc.2`，不内置或修改宿主协议源码。后续版本沿官方接口适配；协议依赖固定到已验证版本，升级时通过回归测试再更新，不承诺任意未来版本自动兼容。

## 开发

```bash
npm ci
npm test
npm run build
npm pack --dry-run
```

- [服务端入口](src/index.ts)：持久化、RPC、原生预设联动及工具拦截。
- [权限分类器](src/classify.ts)：命令与路径所需权限。
- [客户端集成](src/client.js)：原生菜单与状态同步。
- [矩阵编辑器](src/GuardEditor.js)：单格、整行及全局开关。
- [测试](tests/)：分类器、RPC、原生菜单和矩阵交互。

当前回归测试共 174 项，包括全部 4096 种模式的客户端校验。测试覆盖不代表对任意 Shell 程序的安全证明。npm 打包前会自动构建；构建产物与依赖目录不提交到 Git。

## 来源与致谢

这个项目属于同一条探索路线：让 coding agent 能完成工作，同时让操作权限可表达、可检查。

| 项目 | 与本项目的关系 |
| :--- | :--- |
| [lloydzhou/bash-agent](https://github.com/lloydzhou/bash-agent) | 最小化 AI coding agent 运行时；本插件的四范围、四位八进制权限模型与命令分类思路参考其 [Bash 工具权限策略](https://github.com/lloydzhou/bash-agent/blob/main/docs/bash-tool-policy.md) |
| [lloydzhou/bash-guard](https://github.com/lloydzhou/bash-guard) | 面向 Claude Code / Codex 的独立安全门；本插件借鉴其显式权限、执行前检查和可解释拒绝的方向，针对 DSH 重新实现集成 |
| DeepSeek Harness / Cordis | 提供插件生命周期、原生权限 UI、数据域和 RPC 接入基础 |

**相同的权限表达，不同的宿主集成。** 请以本仓库实现与限制为准，不要直接套用其他项目的安装命令、环境变量或安全承诺。

## License

[MIT](LICENSE) © lloydzhou。官方协议与其他依赖遵循各自的许可证。
