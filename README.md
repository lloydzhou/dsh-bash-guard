# DSH Bash Guard

独立 DSH bundle，不修改宿主源码。权限下拉保留原生预设，在同面板增加一个「bash-guard 自定义」入口，激活后内联展开四行分段控件，不增加数字预设或斜杠选择器。

## 安装与启动

```sh
npm install
npm run build
/usr/local/bin/dsh plugin --profile web add /absolute/path/to/plugins/dsh-bash-guard
/usr/local/bin/dsh --profile web
```

目录安装是链接；宿主入口或 manifest 改变后需重新启动测试进程，不能仅凭安装成功宣称运行实例已更新。不要停止其他正在使用的实例。

## 权限语义

四位字符串 system / external / network / workspace，每位 `4=read,2=write,1=execute`。初始记忆值 `0467`，guard 初始不激活。

激活 guard 先通过原生权限服务选择 `workspace-write + ask` 基线，然后持久化 active=true。已接管的 bash / read / write / edit / grep / glob 等工具按全部累计权限位判定；未知工具保持原逻辑。允许后仍执行原生工具和底层沙箱，guard 不提升沙箱权限。拒绝返回 BASH_GUARD_DENIED。

UI 是四行 scope × 读/写/执行三列的独立二态按键矩阵，每行支持0–7全部组合。方向键只移动焦点，空格切换单个位；保存期间不改变菜单高度、不整组置灰。选原生预设会让 guard 失活，保留 mode；再次激活恢复 mode。

## 持久化与并发

DSH storage-domain 中的 bash_guard 域，以 session.id 为键保存 mode、active、revision 和最近原生预设切换位置。写入先落盘，再确认 UI。会话内写入串行，revision 防止过时编辑覆盖新值。守卫在执行前等候已开始的状态写入。

UI 使用独立 RPC `bashGuard/get` 和 `bashGuard/update`，不注册命令、不使用命令轮询，不申请额外会话写句柄。配置权威来源是插件数据域。协议兼容模块来自当前宿主 0.2.0-rc.2，附 MIT 许可与来源；发布版旧协议的私有标记与此宿主不兼容。

同 ID 重开恢复状态。JSONL 导出、历史回退和分叉不会自动复制侧存储，新会话默认不激活。当前不宣称子代理自动继承；跨代理任务仍依靠原生工作区沙箱。不得将它描述为不可绕过的安全隔离。

## 开发与验收

`npm test` / `npm run build`。分类器是保守扫描器，不是完整 Shell AST；未知工具、符号链接、动态程序行为仍依赖宿主隔离。端到端验收与单元测试分别报告，设计参见 DESIGN.md；最新持久化方案以本文为准（原生 bash-guard/mode 事件方案不再采用）。
