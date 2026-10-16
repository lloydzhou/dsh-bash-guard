# 已安装宿主兼容性核查

本核查针对 /usr/local/bin/dsh 指向的桌面 App 编译产物，不是旧源码 fork。2026-10-16。

## 可以纯插件实现的部分

已安装 UI 有 `conversation.input.permission` single/session slot。原生 ui-permission-presets 注册优先级 0，独立插件可注册 priority -100，由 slot 的公开 shadow 规则替换完整控件，不必注入 DOM 或修改编译文件。组件接收 `locked`、`sessionId`、`useSession`、`useProjection`，自有 actions 由 inject(sessionId) 提供。

因此可保留原生三预设、追加一条 guard 入口并在同面板内联展开四行；无需新增六个预设或斜杠菜单。

宿主 sessionProjections 支持独立键，但已有 `permissions` 键的注册不能被新定义覆盖：相同键和 stateVersion 复用首个定义。不能假称已扩展其 KnobState。

## 独立旋钮事件持久化缺口

已安装 dsh-session `Session.append(type,data,...opts)` 构造事件时只复制 type/seq/time/data 和 surfaceOp/sourceEventSeqs，不提供 ignorable 选项。

宿主恢复器对不在编译期 KNOWN_SESSION_EVENT_TYPES 中的事件要求 envelope `ignorable:true`。bash-guard/mode 不在该内置集合中。单纯追加该事件可能当前会话可用，但重开时拒绝加载，违反设计验收。

不能通过修改导出的 Set、prototype patch、借用 command/run 或既有旋钮事件来伪装解决：它们不是已确认的数据契约。

## 更正：插件自有持久化可行，不必修改宿主

后续核查找到正式的 storage-domain 扩展：独立插件可通过 ctx.storage.domain.open(spec) 声明自己的数据域，以 sessionId 为键保存 mode / active / revision。KV put 在后端提交后更新内存并发出 domain/changed。配合自有 RPC/变更通知和现有权限 UI slot，能完成纯插件实现，不需覆盖内置 permissions 投影。

建议采用 workspace-write + ask 为基线，guard 激活时只额外约束已支持的工具；未接管工具走原生逻辑。放行不提升 sandbox 权限。原生预设切换使 guard 失活但保留 mode。

必须明确：此方案支持相同安装内按 sessionId 重开恢复，但不是把 bash-guard/mode 写进原生 session JSONL；仅导出会话日志不会携带插件域数据，fork/迁移需插件另行支持。不可把它宣称为原事件回放契约已经达成。

下述限制仅针对严格要求原生 session 事件和原 permissions 投影扩展的实现路线，不意味着插件功能不可实现。

## 严格原生事件路线的宿主支持需求

至少需要提供正式的外部事件 append 入口，将 ignorable:true 写入冻结持久 envelope；并确认缺少插件时允许忽略 guard 状态是否符合权限安全语义。安全相关状态不应在插件缺失时静默恢复成较宽权限。

若要求 guard/mode 是不可忽略的 required 权限事件，则应通过受支持的宿主版本内置此事件及其兼容规则，或提供 required 外部事件依赖机制，而不是绕过恢复验证。

原设计的「同一 permissions KnobState/投影扩展」同样需要宿主 permission-presets 提供扩展 seam，或按原先提出的 fork 实现。独立插件不能用重复注册同一投影键覆盖内置定义。

## 当前真实状态

已经移除独立 bundle patch 中误加的六个数字预设；尚未重新部署或启动验收。旧的斜杠菜单代码、command 历史 fold 仍是待替换草稿，不代表设计完成。当前 profile 安装的是本目录链接，因此下次启动会读取这里最新的 patch。原有服务未被我重启。
