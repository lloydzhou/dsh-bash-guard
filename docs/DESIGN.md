# 历史设计草案（已过时）

> 仅记录最初探索，不是当前产品契约。当前版本使用 12 个独立权限位、默认 4667、Full access 基线和可选 Jev 设置弹窗。请以 README 与 SECURITY.md 为准。下述分段预设、键盘修改值和会话事件方案均已被替换。

## 最初方案：Bash Guard 第三权限旋钮

依据用户恢复的原设计，禁止自行改成预设列表、斜杠选择器、弹窗或飞出子菜单。

## 实现载体

当前目录独立插件，使用 /usr/local/bin/dsh 安装到 web profile。不得以修改无关源码 fork 替代安装验证。若已安装宿主缺少所需扩展 seam，先说明具体缺口，不得变更交互设计来规避。

## 同一个权限下拉，两态渐进披露

收起态：保留三个原生预设；分隔线；gear/outline 图标 +「bash-guard 自定义」+ 等宽当前四位数（初始 0467）+ chevron。

激活态：三个预设无勾，guard 行有原生勾；同面板内联展开四行，缩进对齐文字起点，无额外边框、彩色 chips 或装饰。

- 系统：无 0 / 只读 4 / 读写执行 7
- 外部：无 0 / 只读 4 / 读写 6
- 网络：无 0 / 只读 4 / 读写 6
- 工作区：无 0 / 只读 4 / 读写 6 / 完全 7

点分段即时持久化，不设保存按钮。选原生预设：guard 失活并收起，勾移回预设，四位数保留。再次选 guard 恢复已存值。首次激活直接使用 0467。

## 数据契约

sandbox/mode、approval/policy、bash-guard/mode 为三个独立旋钮。KnobState / 权限投影增加 guard 模式及激活状态。permission/preset: bash-guard 仅表示意图，不将每个四位数字塞入预设表。执行判定读取 guard 实际模式与激活状态，不从 UI 状态或 assistant 文本推导。未挂载插件时不出现新入口。

会话切换隔离、重开/回放稳定，预设切换不丢 guard 模式。服务端完成写入并推送投影后才确认成功，错误/等待态不可假成功。

## 原生视觉与无障碍

沿用原菜单行高、图标尺寸、hover、separator、check glyph、圆角；不硬编码色值。使用 DSH label-primary / secondary / tertiary、interactive-bg-hover / hover-solid、border-l1、code font tokens。分段约 24px。深浅主题都实际查看。

键盘上下切 scope、左右切档位，保留菜单 Escape/外点关闭及可见焦点，不因点击分段关闭菜单。整个菜单只有一个当前选中身份。

## 验收

1. 菜单恰为原生三预设 + 一个自定义入口，绝非六个 guard 预设。
2. 收起/展开、即时写入、切回预设保留数字、再激活均符合约定。
3. 会话隔离、重开回放、真实 tools/execute 拒绝/放行证据。
4. 深浅主题与键盘、错误态、加载态。
5. 实际 /usr/local/bin/dsh --profile web 验证；测试实例与用户原实例明确区分。
