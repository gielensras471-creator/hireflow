# REFINE-03 · R03-B 审查证据

本轮仅提交 R03-B，等待总控 A 专项验收；不代表整个 REFINE-03 或正式 AC 验收通过。

- 起始 HEAD：2c65083a15564a61533bc7402e596b257ec8e57a
- PR 原始 Base：e087241f2bc442364fb4ee71bf7432ede94f14f4
- 分支：review/e3-ui-refine-03；沿用 Draft PR #9，目标 feature/hireflow-v3。
- 批准设计已完整读取，来源与原件 SHA-256 见 [design-source.md](design-source.md)。原件中的历史起草状态以 Owner 本轮明确批准为准，未改写冻结设计。
- R03-A 原始红/绿证据未修改。R03-B 没有重新声称发生用户草稿丢失。

## 实现与文件

| 文件                                  | 本轮改动                                                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| src/views/V3Recruiting.vue            | 顶部真实身份/职位及四种独立状态；只读四阶段位置；当前任务说明与同页滚动/标题焦点；将原有四面板各一个实例排入任务区，资料自然滚动侧栏 |
| src/styles/v3-recruiting.scss         | 1440px 约 2:1 双栏；1279px 以下同 DOM 下沉资料；1100px 优先任务宽度；390px 不新增整页横滚                                            |
| src/components/V3OfferPanel.vue       | 父级禁止读取时主状态刷新/错误重试不呈现为有效操作，保留独立历史读取                                                                  |
| src/components/V3AdvancementPanel.vue | 同上，保留真实晋级历史                                                                                                               |
| src/components/V3FeedbackPanel.vue    | 同上，保留已有评价历史入口                                                                                                           |
| src/views/V3Interviews.vue            | 局部主状态刷新服从 props.disabled；独立面试页面仍由自己的状态控制                                                                    |
| tests/browser/v3-feedback.mjs         | R03-B 断点、UID、草稿、四状态、局部刷新加载/排队/失败/恢复、任务导览无 URL/写入变化及 H2 焦点                                        |
| tests/browser/r03b-summary-checks.mjs | 实际摘要 DOM 与确认过的 API 数据、隔离 DB 对账；区分处理中旧确认版本与已提交版本                                                     |
| tests/browser/v3-advancement.mjs      | 接入实际摘要对账；隔离夹具关闭时释放连接，避免断言失败且响应被扣留时清理挂起                                                         |
| tests/browser/v3-offer.mjs            | 接入实际摘要对账，包括 accepted+active 与最终 hired                                                                                  |
| tests/v3-readonly-fallback.test.js    | SSR 模板夹具补充真实模板使用的 disabled prop；未删减原有未知/缺失值断言                                                              |

没有新增只读 API、写入命令、Gate、编辑器或第二套桌面/移动实例；没有修改后端、Schema、权限、幂等、409、401/403 逻辑或 V2。

## R03-A-P2-01 定点修复

主状态刷新按钮与 load 的 props.disabled 边界对齐。父级正在加载、编辑租约导致排队、父级失败时四处均不可操作；父级重试且子读取完成后四处恢复。历史按钮未被一并禁用。独立面试页的刷新、失败重试、列表分页由本轮 Interviews 回归验证。

证据：

- [加载时禁止局部刷新](feedback/r03b-loading-refresh-disabled.png)
- [排队断言记录](feedback/r03b-queued-refresh-buttons.json)
- [失败保持上下文并禁止操作](feedback/r03-refresh-failed-blocked.png)
- [恢复四处局部刷新](feedback/r03b-local-refresh-recovered.png)

本项已实现并通过隔离验证，等待总控正式销项。

## 桌面与实例证据

- [1440px](feedback/r03b-layout-1440.png)、[1100px](feedback/r03b-layout-1100.png)、[390px 回归](feedback/r03b-layout-390.png)。
- [布局测量、四面板 UID、编辑器 UID](feedback/r03b-layout.json)。
- [同申请刷新 mount/unmount 观察](feedback/r03-lifecycle.json)；没有观察到四面板卸载。
- [真实面评保存后的 UID](feedback/r03-real-save.json)。
- 1440px 任务首屏 bottom 约 571px；实际双栏约 751/375px。1100px 同实例下沉为一栏；390px 内容宽度 382px，不超 viewport 390px。最终数值以 JSON 为准。
- 1440→1100→390→1440 保留真实未保存面评草稿、编辑器 UID、四面板 UID。任务导览只滚动并聚焦既有 H2，路由全文不变，HTTP 写入数不增加。

## 顶部状态与事实边界

[Feedback](feedback/r03b-summary-matrix.jsonl)、[Advancement](advancement/r03b-summary-matrix.jsonl)、[Offer](offer/r03b-summary-matrix.jsonl) 保存每次真实截图对应的 DOM 文案与状态值。覆盖筛选、初面、复面、Offer、已结束；Offer preparing/sent/accepted 与 hired 独立。active+accepted 显示尚未结束及待 HR 确认，不显示已录用。

在受控扣留写响应场景，数据库可能已提交而父页仍持有旧的已确认 API 摘要；测试明确记录 confirmedVersion/databaseVersion，只允许编辑器持有期间出现这种差异，不把它报告成最新写入结果。最初新增断言误将此差异视为失败，已修正测试并重新通过，不改产品写入语义。

顶部任务文字不推断资格，不宣称可直接晋级或录用。已结束申请展示真实结果/原因并导向既有评价与历史更正入口。四阶段位置仅表示当前阶段，不充当事件时间线。

## 本轮实际验证

| 命令/范围                                                            | 结果                                                 |
| -------------------------------------------------------------------- | ---------------------------------------------------- |
| pnpm test                                                            | 190 通过、0 失败、0 跳过                             |
| pnpm exec vue-tsc --noEmit                                           | 通过                                                 |
| pnpm lint                                                            | 0 错误、1 条既有 V2 dashboard/index.vue 属性顺序警告 |
| pnpm build                                                           | 通过，产物不提交                                     |
| 变更文件 Prettier                                                    | 通过；JSONL 为原始逐行证据，不作为 Prettier 输入     |
| git diff --check / 暂存差异检查                                      | 已通过，含全部 153 个暂存路径                   |
| Recruiting / Interviews / Feedback / Advancement / Offer / Dashboard | 六批真实 Chromium 均重新执行通过                     |

执行方式：Node >=24、项目既有 pnpm；每个浏览器脚本建立独立内存 V3 SQLite、真实本地 Express/Vite、虚构 HR 和 Chrome/157.0.8103.39。R03 专项启用 R03_A=1、R03_B=1。命令为 node tests/browser/v3-<suite>.mjs docs/review/e3-ui-refine-03/r03-b/<suite>。六份原始 results.json 保存在对应目录。

Node 首次曾因 SSR 夹具缺少 props 上下文出现 2 个失败；补齐夹具后全量 190 通过。摘要辅助测试先修正了 Vue Proxy 序列化和在途已提交版本的假设，再重跑成功。受控断网会输出 socket hang up，属于响应丢失用例，不代表额外产品异常。

## 生命周期门禁与未完成范围

| 门禁        | 本轮证据/边界                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------ |
| L03         | 断点变化、草稿、四面板及编辑器 UID 保持                                                          |
| L04         | 六批既有未决写入回归；[原 Key/正文证据](feedback/r03-write-evidence.json)，真实事件/回执一次效果 |
| L05         | Recruiting/Feedback/Advancement/Offer 真实 409 读最新后人工确认回归                              |
| L06         | 六批操作级 403、身份异常/撤权区别回归                                                            |
| L07         | 原共享租约，双方异步打开互斥与单编辑器回归                                                       |
| L08         | 同申请父刷新、排队、失败、恢复及真实保存后 UID 保持                                              |
| L09         | 延迟父响应、跨申请/跨账号、旧表单失效隔离回归                                                    |
| L01/L02/L10 | 本批任务导览已验证 URL 不变与标题焦点；完整页内导航、资料折叠/焦点回退仍属 R03-C，未宣称最终通过 |

没有真实设备、屏幕阅读器或生产数据验证；没有正式完成 AC-01～AC-36。草稿断点组合专项集中于面评，其余编辑器通过各自业务回归，不冒称穷举全部交叉注入组合。旧批次结果 JSON 中的历史 limitations（例如未审 HR UI/Dashboard）仅代表该脚本本身的测试边界；本轮另运行对应独立脚本。

R03-C 完整移动 IA/折叠、R03-D 历史摘要、R03-E 综合验收尚未实施。没有合并、部署或触碰目标分支/main。
