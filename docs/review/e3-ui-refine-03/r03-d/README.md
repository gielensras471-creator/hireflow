# REFINE-03 · R03-D 实施与审查证据

授权 DEC-E3-UI-REFINE-03-R03D-AUTH-01；沿用 review/e3-ui-refine-03 / Draft PR #9。
起始 HEAD c0f9a9d2e9db44866ed0943b35baca3f41d3f32f，PR Base e087241f2bc442364fb4ee71bf7432ede94f14f4。仅实施 D，等待总控专项审核；不代表 E 或正式 AC 全部验收。

## 开发前核验与来源

AGENTS.md、Owner 补充设计第 4/5/7/8 节及实际领域服务/路由/DTO 已读取。
[来源—字段—完整性—排序—展开入口矩阵](source-matrix.md)在编码前建立。原设计来源记录保留于 [R03-B](../r03-b/design-source.md)。
开始时本工作树干净、本地/远程 SHA 一致；其他 worktree 只读核查无未提交内容。A/B/C 原始证据未改动。

| 来源         | 可确认范围                                       | 默认规则与成本                                                                                            |
| ------------ | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| 面评         | 专用 API 返回单个 feedbackId 的完整事件数组      | 成功后可称该面评来源最近三条，不称全申请面评完整历史。原 readFeedbackHistory 对更正决策关联的游标遍历保留 |
| 晋级         | 专用 API 无 LIMIT，返回该申请全部 stage_advanced | 可称本来源最近三条；不是统一申请全事件                                                                    |
| Offer/结案   | 专用 API 无 LIMIT，完整返回已批准五类事件        | 可称本来源最近三条；accepted 与 hired 独立                                                                |
| 统一申请历史 | 升序游标，第一页不完整                           | 未新增聚合读取，不取第一页前三条冒充最新                                                                  |
| 面试活动     | 当前活动记录及原合法入口                         | 不推导改期/完成/取消全事件链                                                                              |
| 未核实旧档   | 不属于上述新事件完整性保证                       | 常驻说明旧版历史未核实，不将缺失当作从未发生                                                              |

排序为 occurredAt 降序、同时间 eventId 降序；复制数组，不修改 API 原值。排序字段不齐时保持原顺序，标题只称“已加载历史摘要”。完整 API 成功数组 0 条准确提示“当前已读取的该来源未记录可核实的业务事件”；加载/错误继续由独立领域状态处理。

## 实际修改

- src/api/history-display.ts：只读排序/完整排序字段检查与文案；不负责查询或业务决策。
- src/components/V3FeedbackHistory.vue：单条面评源最近三条、全部控制、默认收起单条原始快照、未知/原型属性事件名安全回退。
- src/components/V3AdvancementPanel.vue、src/components/V3OfferPanel.vue：原历史区域内摘要与全部控制，原原因/缺评清单/原新状态均保留。
- src/styles/v3-recruiting.scss：局部摘要换行及 44px 控制。
- tests/v3-readonly-fallback.test.js：新增排序/稳定性/0/1/3/4+/缺字段与真实反馈模板未知枚举测试；原断言保留。
- tests/browser/v3-feedback.mjs、tests/browser/r03d-history-checks.mjs：真实隔离历史专项、503/403 及请求计数。
- 完整路径与源指纹见 changed-files.json / source-fingerprints.json。

没有新建统一历史组件，没有增加全域历史请求、后端 API 或依赖；未改 DTO、Schema、权限、编辑器、Command Core 或状态机。原 API 未提供的 commandId/额外个人资料不补造；原证据字段及测试钩子均保留。

## 展示、焦点与生命周期

所有单条完整内容仍在原 details 内，通过原生 summary 按需展开。超过三条时仅隐藏其余只读 details，查看全部不删除事件，也不包住任何编辑器。收起全部后将焦点恢复到触发控制。三组领域独立数据所有权和已有 latestRead/账号/路由隔离保持不变。
摘要含事件类型/ID、真实时间、实际 HR/账号及原因；面评另含面评与面试 ID。展开保留最初评价人/提交时间、修订、原新理由、豁免与决策引用；晋级保留原目标阶段与当时缺评清单；Offer 保留前后状态及原因来源。
四面板、共享租约、A/B/C 页内定位与布局均未重构。

## 实际验证与截图

- pnpm test：192 通过、0 失败、0 跳过（原 190 + 新增 2）。
- vue-tsc --noEmit、pnpm build、变更文件 Prettier：通过。
- pnpm lint：0 错误、1 条既有 V2 dashboard/index.vue 属性顺序警告。
- git diff --check / staged check 在提交前执行。
- 六批独立真实 Chromium 全部重新执行：Recruiting、Interviews、Feedback、Advancement、Offer、Dashboard；各自 results.json 在同名子目录；零 V2 请求。
- Feedback 同时启用 R03_A/B/C/D=1。原父刷新/失败/排队、409 人工确认、403/401、未决原 Key/正文与跨申请/账号回归保留。
- 历史专项通过真实合法 API 建立首次提交 + 六次更正共七条事件，同一服务器时间下按 eventId 稳定排序。逐条展开七条事件，对照 API 的 before/after 理由与修订，未用当前状态伪造历史。
- 实际 Space/Enter 展开证据、收起全部及焦点恢复；编辑器有未保存草稿时，390/1100/1440 调整与历史展开保持 UID、草稿、URL。HTTP 写请求增加 0，事件/回执不变。
- 直接注入历史 GET 503 与操作级 403：错误可重试，晋级来源内容不丢失，有效登录会话保留；重试后面评历史恢复。

[0 条来源](feedback/history-empty-sources.png) · [1 条](feedback/feedback-history-1.png) · [3 条](feedback/feedback-history-3.png) · [4 条](feedback/feedback-history-4.png) · [7 条](feedback/feedback-history-7.png)。
[完整快照与草稿](feedback/history-full-snapshots-and-draft.png) · [390](feedback/history-layout-390.png) · [1100](feedback/history-layout-1100.png) · [1440](feedback/history-layout-1440.png)。
[503](feedback/history-error-503.png) · [403](feedback/history-error-403.png) · [事件ID、逐条展开、键盘及计数](feedback/r03d-history.json)。

豁免和后补录沿用本轮重跑 Feedback 的 feedback-historical-missing.png / feedback-supplemented.png；
accepted/hired 分离与拒绝/普通结案见本轮 Offer 截图与 results.json。原主视图“接受不等于录用”及完整原新 Offer 状态保留。

初轮新增测试补齐异步编辑器就绪等待，并恢复测试确认弹窗处理模式；格式检查后重新启动浏览器，最终结果不采用 HMR 中间态。没有删除旧断言、减少旧事件样本或修改业务 API 规避失败。

## 验收范围与未验证边界

1. 面评有 0/1/3/4+/七条真实事件及六次修订；晋级受四阶段限制，单申请最多三次合法晋级，不能安全造出四次。Offer 的合法一次性生命周期同样有界，未为凑 4+ 条篡改状态或历史。4+ 条显示规则由面评真实链与共享排序单测验证。
2. 未知事件/原型属性回退通过实际组件模板 SSR 验证；旧版状态未知由本轮重跑 C 专项的明确只读响应投影验证，不冒称真实旧档迁移/全链路。
3. 部分/缺排序字段通过排序与文案单测；专用完整数组不提供分页/部分标志，前端依赖该已审后端契约，不能识别服务器错误地返回一段格式正常但被截断的数组。
4. 历史专用 503/403 直接实测；跨账号/申请迟到响应、401、409、未决重放沿用本轮业务专项，未穷举三类历史请求各自延迟与账号切换的全部组合。
5. 查看全部仍保留整组原始 DOM/快照；极长历史的内存/DOM 成本未做性能压测，不引入未经批准的后端分页/倒序接口。
6. 没有真机、读屏、生产数据或正式 AC 全量验收。R03-E 综合验收未实施。

本轮实现与证据供总控 A 审核；保持 Draft，不 Merge、不部署、不开始 E。
