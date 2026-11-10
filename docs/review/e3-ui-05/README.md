# E3-UI-05 招聘工作台审查

授权 DEC-E3-UI-05-START-01。基线 74741269cb3acd95a3d8d7fb3e3152fdf712ffc0，review/e3-ui-05 → feature/hireflow-v3。独立 worktree E:/FIFile/Documents/Codex/hireflow-v3-ui05；原审查工作区及 5174 用户预览保留，未切换其分支或启动新的持久服务。

## 实现及源码

- src/views/V3Dashboard.vue：真实四指标、四主两次待办、三种 Offer 明细、分页、今日面试及辅助统计。三路读取分别 Loading/Error/Retry；失败清除旧值，空数据才显示真实 0。
- src/components/V3DashboardTable.vue：复用表头/逐列骨架，ID、真实阶段及状态、业务时间类型与合法申请链接；独立容器滚动。
- src/api/dashboard-v3.ts：真实 DTO、记录单位、时间含义及有界分页契约。
- src/styles/v3-dashboard.scss：批准的 V3 tokens、指标/待办/明细/今日面试+统计层级及响应式布局。
- src/router/v3.ts：仅把 dashboard 占位路由接入新页面。
- tests/v3-dashboard-ui.test.js、tests/browser/v3-dashboard.mjs：单位/时间语义边界与真实 HTTP Chromium 验证。
- 五份已有浏览器回归脚本仅把工作台标题更新为“招聘工作台”，并设置独立临时 Vite cacheDir，避免共享依赖缓存干扰用户预览；其业务断言保留。

没有修改后端统计、Schema、业务状态机、V2、冻结文档或公共认证。没有 Mock、随机业务指标、趋势/漏斗推算。页面刷新不调用写接口。不同 API 返回不宣称同一数据库事务快照。

## 批准 Figma 对照与适配

实际通过 Figma MCP 读取 4:16 的高保真上下文和截图，沿用 Shell、主色、卡片、间距、四主两次级待办、明细表、今日面试与辅助条形统计。没有使用聊天中的结构草图。

设计适配（供 03 独立复核，不自行宣布设计通过）：

1. 原画板三个核心指标，本任务明确要求四个，因此增加“已确认录用记录”；accepted 不算 hired。
2. 原画板辅助“阶段分布”无对应批准 API，改为 API 支持的申请状态、活跃 Offer 和分类待办统计；今日状态使用真实 byStatus 数字。不伪造阶段/趋势/漏斗。
3. 当前明细 API 没有姓名/职位名称，展示稳定申请/职位/面试 ID；不全表扫描或推断名称。管理申请入口跳转现有申请列表，不新增创建路由。
4. 数据可超过示例三行，采用服务端每页 10 条和表格容器独立滚动；390px 指标单列、待办两列、下方区域单列。
5. softDeletedOpen、创建时间含义、计量单位和多 API 读取边界以简短说明显式呈现。非阻断动画及全站视觉收口未扩展。

## 实际质量门禁

| 命令                                                 | 结果                                            |
| ---------------------------------------------------- | ----------------------------------------------- |
| pnpm test                                            | 181 通过、0 失败、0 跳过；新增 2 项前端契约测试 |
| pnpm exec vue-tsc --noEmit                           | 通过                                            |
| pnpm lint                                            | 0 错误；1 个既有 Dashboard V2 属性顺序警告      |
| pnpm build                                           | 通过，未部署                                    |
| 变更文件 Prettier / git diff --check                 | 通过                                            |
| node tests/browser/v3-dashboard.mjs <外部输出目录>   | 完整实际 Chromium 验证通过，见 results.json     |
| UI-02 / UI-03A / UI-03B / UI-04A / UI-04B 浏览器脚本 | 本轮串行实际全部通过，结果同目录                |

环境：Node v24.17.0、Windows Chromium、fresh V3 内存 SQLite、随机虚构 HR 密码/JWT、loopback API/Vite。脚本自关闭所创建实例；不关闭用户原有 5174 预览，不保存凭据或真实资料。

开发期发现并修正：面试状态类型索引不完整；路由最初仍指向占位组件；同账号会话复核返回的新对象不应使 watcher 无谓重置读取状态（会吞掉操作级 403 提示）。修正后完整运行通过，无未解决失败。旧代理端口不可用，新临时代理 20218 已通过远程核验；未改全局设置。回归中的 socket hang up 是原有故意丢失响应场景。

## 浏览器证据与边界

- 真实空库 0；合法 API 创建职位/申请后指标变化；合法归档后 openPositions=2、softDeletedOpen=1。
- 六类待办逐条比对来源 ID；同申请两场完成未评产生两个面评工作项，旧轮历史缺评排除。
- Offer preparing/sent/accepted 分别存在且独立查看，单独 confirmed hire 计入 hired。
- 固定上海时钟在 13:59:59 / 14:00:00 / 14:00:01 下，UI 刷新后 due 与服务端一致且预约仍 scheduled；今日 1 预约/4 完成/1 取消。
- 服务端分页、切换类别、Offer 子状态、旧响应延迟释放后不覆盖新类别；刷新前后事件/回执数量不变。
- 指标/明细/今日局部错误独立显示与重试，错误不伪装 0；操作级 403 保留有效会话及拒绝提示。
- 实际申请跳转、账号切换、数据库真实撤权后退出并清除指标；1440px / 390px，整页无横向溢出；零 V2 请求。
- 极端跨上海零点/次日边界、软删除和复杂权限/历史组合还由本次实际运行的 tests/dashboard-service.test.js、tests/v3-dashboard-history-http.test.js 覆盖，不冒充全是新增页面浏览器验证。
- 尚未完成正式 AC-01～36、实机触屏/屏幕阅读器全量验收；本批相关 AC-17/18/21/22/29/30/35/36 提供隔离证据，不自行勾选通过。

## 文件索引与交接

本目录包含桌面首屏、完整桌面、六类待办、明细、今日面试、Offer 子状态、加载/空/错、390px 及跳转详情截图；results.json 和五批 regression JSON。均为真实 Chromium 截图与虚构数据，无凭据。

交接节点：实现完成，提交 Draft PR 后停止，等待总控 A 源码验收和 03 设计复核。禁止自行 Merge、生产部署/迁移、改动 main/目标分支或启动下一批。
