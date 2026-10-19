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

不改宿主源码，不增加一排数字预设，也不用记斜杠命令。展开 `Bash Guard 自定义`，直接调整系统、外部、网络和工作区的读、写、执行权限。

> **Bash Guard 使用原生 Full access 基线，不使用工作区沙箱。** 激活前需要确认风险；仅支持的工具受权限位限制。未接管工具和无法准确分类的动态行为不受同等保护，Guard 不是安全沙箱。

## 为什么使用它

- **权限看得见。** 四行三列，12 个独立开关，支持全部 4096 种组合。
- **原生菜单，不打断工作。** 保留原生权限选项、图标和风险确认；修改时菜单保持展开。
- **从单格到整行。** 点一个格子切换一个权限位；点 scope 名称全选或清空这一行。
- **配置随会话记住。** 同一 session ID 重开可恢复；切回原生预设停用 Guard，但保留上次数字。
- **判断来源明确。** 本地规则按 `required` 与 `allowed` 比较；可选 Jev 模型按相同权限约定判断，拒绝信息标明来源，模型拒绝不会伪装成本地权限计算。

## 快速开始

### 从 npm 安装（推荐）

需要 DSH `0.2.0-rc.2` 或更新版本；兼容范围说明见下文。插件安装到 DSH 的 `web` profile，无需全局安装 npm 包，也无需克隆或手动构建。

```bash
dsh plugin --profile web add dsh-bash-guard
dsh --profile web
```

安装后重新启动对应的 DSH Web 实例，在权限菜单中选择 **Bash Guard 自定义**。

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

在输入框附近打开权限菜单，选择 **Bash Guard 自定义**。

目录安装采用链接。更新插件后重新构建；宿主入口或插件配置变化时，重启对应的 DSH 实例。

## 在菜单中操作

| 入口 | 行为 |
| :--- | :--- |
| 单个权限格 | 独立切换该范围的读、写或执行位 |
| 系统 / 外部 / 网络 / 工作区 | 已全选则清空该行，否则全选该行 |
| 全选 | 当前不是 `7777` 时显示，点击将全部 Guard 位设为 `7777` |
| 默认 | 当前是 `7777` 时显示，点击恢复 `4667` |
| 原生权限预设 | 停用 Guard，保留记忆的四位值 |

方向键在矩阵中移动焦点，不修改权限；空格切换当前按钮，Escape 关闭菜单。状态由服务端确认，保存时不插入提示行或改变菜单高度。

**统一默认值为 `4667`：** 系统只读、外部读写、网络读写、工作区全部。新会话初始记忆值和菜单“默认”按钮的恢复值一致，Guard 初始不激活；已有会话不会因升级自动重置。

界面支持中文和英文，跟随 DSH 的语言设置，无需单独配置。品牌名统一显示为 **Bash Guard**。

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
| `4667` | 默认：系统只读；外部与网络读写；工作区全部 |
| `4447` | 系统、外部、网络只读；工作区全部 |
| `0007` | 仅开放工作区的三个权限位 |
| `7777` | 在原生完全权限基线上开放全部 Guard 位，不再提供权限位限制 |

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
         └─ 全部满足 ────────────────────► 原生 Full access 工具执行
```

判定规则是 `(allowed & required) === required`，不是比较数字大小。复合命令会累计多个范围的要求，不会只取一个“最高”范围。

例如，同样执行 `cat /etc/hosts`：

- `0467` 缺少系统读取位，拒绝，`required=4000`。
- `4467` 满足 Guard 的系统读取要求，之后仍需通过原生执行路径。

这组场景已在实际 DSH Web 会话验证：前者被拒绝，后者在工具原始结果中返回文件内容。

当前分类器接管 `bash`，以及 `read`、`read_image`、`grep`、`glob`、`ls`、`write`、`edit` 等已识别工具名称。读取工具按目标路径检查读权限，写入工具检查写权限。未接管的工具继续走宿主原有策略。

## 可选 Jev 判断模型

默认仍使用本地规则。激活 Guard 后，权限矩阵下方的「判断方式」可以选择「本地规则」或「Jev 模型」，右侧设置入口打开 **Bash Guard 设置**。

1. 在设置中填写 API Key，模型默认 `jev-latest`。
2. 服务地址默认 `https://api.typesafe.ai/v1/systemone`，超时默认 4000 ms。更换服务地址需要重新输入密钥，不会把旧密钥静默发送到新地址。
3. 如果直连不可用，在高级设置的 HTTP 代理中填写例如 `http://127.0.0.1:7891`。只影响 Jev 请求，不更改宿主全局代理；留空不指定代理。该地址由 **DSH 服务端** 访问，远程部署时 `127.0.0.1` 指服务器自身。支持 HTTP(S) 代理，不接受 SOCKS 或带用户名密码的 URL。
4. 可先「测试连接」：只发送固定测试样例，不发送当前会话命令。
5. 保存后，在需要的会话里选择「Jev 模型」。

模型、服务地址、密钥和超时由当前 **profile 共用**；判断方式和四位权限按会话保存。密钥只保存在服务端插件数据域，读取设置只返回是否已配置，不返回密钥。这里不是系统钥匙串或加密保险库，仍需保护 profile 的本地文件与备份。

Jev 与本地规则输出**同一种东西：`required` 权限数字**，最终放行与否永远由你自己的按位比较决定。模式为 **7777** 时完全放行，不调用 Jev 也不调用本地规则；其余模式下，启用 Jev 的会话把当前操作发给 Jev，由 12 个校准概率问题（4 范围 × 读/写/执行，每问概率 ≥0.5 记该位）组装出 `required`，再与配置模式做位比较；请求失败、超时、响应无效或输入不便发送时回退本地分类器计算 `required`。拒绝信息统一标明来源与位计算：`source=jev; required=6000 allowed=4667`。本地分类器保守高估的命令（如含 `$result` 被算成 `7777`），Jev 可以给出更准确的需求位而放行。权限矩阵的含义不变，外部路径按外部权限位判断，而非一律拒绝。

**数据外发提示：** 工具名称、绝对路径、命令、文件匹配模式及权限上下文会发送到所配置的服务。文件写入正文、替换内容和 grep 搜索文本不发送；命令里的内嵌内容仍可能包含私有数据。脱敏不能保证发现所有秘密，不应将凭据放入命令。检测到敏感数据、输入不完整或超出请求上限时不会发送给 Jev，直接按本地规则判断（不发送、不外泄）。模型分类不是沙箱，且不会覆盖宿主的拒绝。

## 安全边界

完整数据外发说明、密钥存储限制和漏洞报告方式见 [安全与隐私说明](SECURITY.md)。

请在使用前了解这些限制：

- **不是不可绕过的隔离层。** 分类器是保守词法扫描器，不是完整 Bash AST，也无法证明任意脚本或程序的运行时行为。
- **激活会提高原生权限。** 风险确认后选择 `danger-full-access` 预设，由 Guard 限制已支持的操作。要求该预设为 `approval=never`，并通过宿主 sandboxPolicy 与 approval 服务核验会话实际状态；不符合则拒绝激活并回退。`never` 表示不会弹审批，其他原生规则要求审批的操作会被拒绝，而不是自动批准。旧版 workspace-write 基线的已激活记录不会静默升级，需要重新激活。
- **不覆盖所有工具。** 未识别的工具不会自动被本插件拦截，仍依赖宿主策略。
- **不保证符号链接与动态路径隔离。** Full access 不提供工作区沙箱边界，不能依赖词法分类器隔离实际文件系统、网络或子进程。
- **子代理继承父会话配置。** subagent 通过 `session.header.parentSession` 沿父链继承最近的激活 Guard（mode + 引擎），只读生效、不落盘；父链断裂或祖先未激活时回到未保护状态。会话无记录且无激活祖先时不受 Guard 限制——依赖 Guard 约束时请保持父会话激活。
- **不是 Bash Guard Rust 运行时。** 本插件独立适配了可选 Jev API 决策层，但没有集成 Claude/Codex Hook 或 Rust 审计日志功能，也不宣称相同的安全保证。

需要报告问题？请附上脱敏后的命令、四位模式、预期与实际结果，在 [Issues](https://github.com/lloydzhou/dsh-bash-guard/issues) 中反馈。不要提交凭据或私有文件内容。

## 会话与兼容性

配置保存在 DSH 插件数据域 `bash_guard`，按 session ID 记录模式、激活状态和修订号。写入先持久化再确认；同会话写入串行，修订号防止过时编辑覆盖新状态。

这是插件侧存储，**不是原生会话 JSONL 的一部分**。导出、分叉和历史回退不会自动携带或回放配置。

客户端通过独立 RPC 读写，不使用命令轮询或额外会话写句柄。兼容基线为 DSH `0.2.0-rc.2`，不支持更早的宿主。服务端直接依赖官方 npm 包 `@deepseek-ai/dsh-typert-protocol@0.2.0-rc.2`，不内置或修改宿主协议源码。后续版本沿官方接口适配；协议依赖固定到已验证版本，升级时通过回归测试再更新，不承诺任意未来版本自动兼容。

### 本地 web profile 试用

如果 `web` profile 已通过 `link:` 指向本仓库，执行 `npm run build` 后，需要停止并重新启动该 profile 的 DSH 实例，随后刷新浏览器。服务端新增 RPC 和数据域不是仅刷新页面就能加载的。不要同时启动两个实例占用同一 profile。

```bash
# 在插件目录构建
npm run build
# 停止原有 web 实例后，沿用你自己的端口参数启动
dsh --profile web
```

打开权限菜单，激活 Bash Guard，在矩阵下方选择 Jev 并填写设置。无需发布或安装 npm 新版本；不要将真实 API Key 粘贴到聊天或命令行。

## 开发

```bash
npm ci
npm test
npm run build
npm pack --dry-run
```

- [服务端入口](src/index.ts)：持久化、RPC、原生预设联动及工具拦截。
- [权限分类器](src/classify.ts)：命令与路径所需权限。
- [Jev 请求与校验](src/jev.ts)：服务端配置、数据投影、响应验证与超时控制。
- [Jev 设置弹窗](src/JevSettings.js)：profile 共用模型配置和连接测试。
- [客户端集成](src/client.js)：原生菜单与状态同步。
- [矩阵编辑器](src/GuardEditor.js)：单格、整行及全局开关。
- [测试](tests/)：分类器、RPC、原生菜单、矩阵交互及 Jev 网络错误、密钥隔离和并发变更。

Jev 自动化测试使用模拟响应，不消耗真实 API 配额，也不证明模型在真实任务上的判断质量；首次试用请用无敏感内容的小命令核对决策。

回归测试包括全部 4096 种模式的客户端校验，以及 Jev 配置、超时、回退、敏感输入处理和权限变更竞态。测试覆盖不代表对任意 Shell 程序的安全证明。npm 打包前会自动构建；构建产物与依赖目录不提交到 Git。

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
