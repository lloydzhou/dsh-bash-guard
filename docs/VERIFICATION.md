# 实际验证记录

2026-10-16，/usr/local/bin/dsh --profile web --port 3082 --no-open，独立测试进程，不替换用户其他实例。

## 已验证

- 宿主启动无插件未激活警告，Web 页面可加载。
- 使用原生 Menu / 权限 SVG 图标 / RiskConfirmation，并读取实时权限目录。
- 页面点击 guard：0467，展开系统/外部/网络/工作区四行。
- 页面点击系统只读：更新为4467，保持同一菜单展开。
- 页面点击原生仅可查看：原生选择成功，guard 收起。
- 再开菜单保留4467。
- 网络真实 bashGuard/update 响应 ok=true，mode4467，active=true，revision2。
- DSH storage-domain 后端实际生成 bash_guard/sessions/<sessionId>.json，记录4467。
- 仅重启测试进程后，对同一 sessionId 真实 RPC get 返回4467、active=false、revision3、presetSeq16，符合重启前已选择原生只读的状态。未获取额外写句柄。
- 139项单元/组件测试通过（含真实Cordis与当前宿主协议元数据）。

## 补充端到端验证

- 已激活状态重启恢复已完成：先RPC激活4467 revision4，再重启测试进程；同ID返回active=true/revision4/presetSeq19，页面触发器也显示bash-guard 4467。
- 键盘复验完成：ArrowRight将0467改为4467；写入后ArrowDown焦点位于外部权限/只读，Escape关闭菜单。
- 实际web测试会话执行cat /etc/hosts：0467模式下工具卡明确显示required=4000 allowed=0467的拒绝。改为4467后再次调用，已在轨迹选中第二次bash工具行，事件详情的原始「结果」实际显示hosts内容，确认放行并执行；不是仅依赖Agent总结。
- 原生完全权限菜单实际打开RiskConfirmation，未勾选时启用按钮disabled，取消后未提升权限。
- 浏览器系统主题模拟与重新加载验证浅色/深色，分别截图guard-light-menu.png/guard-dark-menu.png；原生图标、分隔线和勾选保留，四行分段无溢出。

## 已知边界

- 纯插件侧存储不随JSONL导出/分叉自动继承；子代理不保证继承guard。
- 词法分类器不是完整shell隔离，底层原生workspace-write沙箱始终保留。
- 当前原生目录有三项；动态额外目录与auto风险确认有组件测试，未在真实配置提供auto的实例点验。

## 修复过的集成问题

- 删除字符代替图标和自绘菜单。
- 删除硬编码目录与 guard 故障禁用原生项。
- 删除 bash-guard-state 命令轮询。
- RPC 使用当前宿主协议元数据；客户端显式 $mount 描述并在依赖注入子上下文中读取服务。
- 使用实际 Session.snapshotEvents()，不是模拟对象上的events属性。
