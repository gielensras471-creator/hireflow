# REFINE-03 · R03-C 审查证据

本轮为 DEC-E3-UI-REFINE-03-R03C-AUTH-01 的受限实施，等待总控 A 专项验收。原 R03-A/B 提交与证据未修改，未开展 R03-D/E。

- 工作树：E:/FIFile/Documents/Codex/hireflow-v3-refine-03
- 审查分支：review/e3-ui-refine-03；沿用 Draft PR #9。
- 起始 HEAD：1661cdeeaca5c6c7b4a59827a8d26bbae3ec7275。
- 原始 PR Base：e087241f2bc442364fb4ee71bf7432ede94f14f4。
- 已完整读取 Owner 设计补充原件，来源与原件指纹见 [原设计核验记录](../r03-b/design-source.md)。本轮明确授权优先于原件中的历史起草状态，未修改设计、PRD/MVP 或 AGENTS.md。

## 修改范围

| 文件                                  | 本轮修改                                                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| src/views/V3Recruiting.vue            | 移动任务优先的原单实例结构；6 个同页定位入口；只读基本资料/更多资料；焦点恢复；已结束申请导览；真实历史来源入口 |
| src/styles/v3-recruiting.scss         | 局部导航和折叠样式、可见焦点、标题滚动偏移、390px 任务按钮 44px 触控高度与局部表格滚动                          |
| src/components/V3FeedbackPanel.vue    | 实际已有评价的 DOM 标记；当前轮次记录优先，历史记录保留，各组原顺序保持                                         |
| src/views/V3Interviews.vue            | 仅申请内嵌列表当前轮次优先；独立全局分页列表仍保持原 API 排序                                                   |
| src/components/V3AdvancementPanel.vue | 真实晋级历史的定位标记                                                                                          |
| src/components/V3OfferPanel.vue       | Offer/结案真实历史的定位标记                                                                                    |
| tests/browser/r03c-detail-checks.mjs  | 新专项：真实 Chromium 键盘/焦点、折叠、原文、顺序、UID、草稿、URL、HTTP 写入/DB 计数及结束/未知场景             |
| tests/browser/v3-feedback.mjs         | 接入专项；仅测试包装器的旧历史字段投影及安全的请求方法计数                                                      |

未修改编辑器内部、共享 Gate、路由状态、认证、Command Core、业务 API、Schema、迁移或 V2。无新依赖。

## 390px 内容顺序

| 顺序 | 实际 DOM/数据来源                         | 证据                                                        |
| ---- | ----------------------------------------- | ----------------------------------------------------------- |
| 1    | 姓名、职位/ID、申请 ID，四种独立状态      | mobile-390-task-first.png；实际 Application DTO             |
| 2    | 当前任务和合法模块导览，不推断写入资格    | 同上；任务标题/按钮在 390×844、390×900 首屏可辨             |
| 3    | 面试 → 面评；当前轮次优先，历史仍可见     | current-round-first-390.png；真实 API 形成两轮面试并核对 ID |
| 4    | HR 决策 → Offer/结案，原预检与全部操作    | 原面板各一个实例；六批业务回归                              |
| 5    | 简明资料：负责人、电话/邮箱；缺失明确标记 | profile-collapsed-focus.png                                 |
| 6    | 更多只读资料可展开；随后是来源历史入口    | profile-long-expanded-390.png；历史入口不冒充完整统一时间线 |

完整历史仍由原领域组件负责，原域内历史未搬迁、裁剪、合并或伪造。本轮页尾只是可发现的真实来源入口；分来源三条摘要属于 R03-D。

[390×844](feedback/mobile-390-task-first.png) · [390×900](feedback/mobile-390x900.png) · [1440](feedback/layout-1440.png) · [1100](feedback/layout-1100.png) · [390 草稿](feedback/layout-390.png)。

## L01 / L02 / L10

| 门禁 | 实现与实际 Chromium 验证                                                                                                                                                                                   |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L01  | 根节点内真实 DOM 定位；不调用 Router/hash/history 状态。每个断点以原生键盘激活六个定位入口，逐次检查 URL 全文、编辑器 UID 与四面板 UID 不变                                                                |
| L02  | 仅只读更多资料使用 v-show；资料容器不含 form/input/textarea。真实面评草稿保持时展开/折叠和定位其他区，编辑器不重建；没有折叠任何业务编辑器                                                                 |
| L10  | 标题 tabindex=-1、可见焦点与 24px scroll-margin；键盘 Tab/Shift+Tab/Enter/Space/Escape 实际 CDP 输入。焦点在展开内容内时按 Escape 或收起控制，关闭后返回同一控制按钮；重复定位只更新同一标题属性，无新监听 |

折叠默认收起，断点变化不会自动重置展开状态或创建第二套资料 DOM。低频字段完整原文可换行/复制/聚焦，不按视觉截断丢失原文；电话邮箱缺失为“未提供”，其余缺失为“未记录”。Escape 处理只作用于只读展开区域，不改变编辑器和全局导航的原事件机制。

[键盘、顺序、UID、草稿、路由及写入计数原始日志](feedback/r03c-keyboard-lifecycle.json)。390px 内容宽度不超过 viewport；表格保留原生容器横滚，整页不横滚。1440→390→1100→1440 后四面板、编辑器 UID 与草稿保留。

## R03-B-P2-01

实现与隔离验证已完成，等待总控正式销项：

- 已结束申请的主导览明确为“查看已有评价与真实历史”，不显示新的晋级/Offer 资格。
- 存在真实已加载评价时，定位到该条真实卡片，明确具体更正资格仍由原模块核验，不自动打开/提交更正。
- 无已加载评价时，定位到真实历史入口并说明不能认定存在可更正记录，未记录不等于从未发生。
- 未知非空枚举继续“未知，待核实”；缺失结果保持“未记录结束结果”，不虚构事件或结果。
- 无目标时有明确 role=status 反馈，不静默成功。此异常路径通过隔离测试删除只读目标 DOM 验证，未冒称正常用户会遇到该注入。
- 原有合法更正与历史重试入口未删除。

[已有评价](feedback/closed-existing-feedback-navigation.png) · [无面评](feedback/closed-no-feedback-navigation.png) · [未知历史](feedback/unknown-history-readonly-projection.png)。

未知历史使用明确标识的**隔离 GET DTO 投影**：实际关闭记录的只读响应包含未知阶段/Offer 值和缺失结果，用于显示与导览测试；没有放宽正式 API/Schema，也没有修改真实库。此项不等于旧档全链路/迁移验收。

## 保持 L03～L09 与六批业务

R03_A=1、R03_B=1、R03_C=1 一并执行 Feedback 专项，覆盖父刷新加载、成功、失败、排队、恢复与身份恢复；旧父响应跨申请/账号隔离；真实面评保存后四 UID 保持。原未决场景同 Key、同正文，一次事件/回执，原始计数见 [写入证据](feedback/r03-write-evidence.json)。

其他五批独立脚本均重新执行，连同 Feedback 共六批：
Recruiting、Interviews、Feedback、Advancement、Offer、Dashboard。覆盖原 403 操作拒绝不误登出、409 最新事实/人工确认、401/撤权、未决重放、租约互斥与账号边界；面试完成不晋级，active+accepted 不等于 hired。六份 results.json 均在本目录各子目录内，V2 请求为零。

专项准备的职位/申请/资料/双轮面试由现有合法 API 生成。导航/折叠/断点变化期间对比 CDP 实际 HTTP 写请求数及 SQLite events/receipts，均无增加。测试准备与业务回归中的预期合法写入不算作导航副作用。

## 实际命令及结果

- pnpm test：190 通过 / 0 失败 / 0 跳过。
- pnpm exec vue-tsc --noEmit：通过。
- pnpm lint：0 错误，1 条既有 V2 dashboard/index.vue 属性顺序警告。
- pnpm build：通过；dist 不提交。
- 本轮变更文件与证据 Markdown/JSON Prettier：通过。原始 JSONL 保持逐行记录，不作为格式化输入。
- git diff --check、暂存差异检查：均通过，暂存区恰好 161 个授权路径。
- node tests/browser/v3-<suite>.mjs docs/review/e3-ui-refine-03/r03-c/<suite>：六批均真实执行。隔离本地 V3 Express、全新内存 SQLite、虚构 HR、真实 Chromium。

初轮专项先修正键盘夹具缺少 Enter 字符事件；随后补齐任务 h3 的滚动偏移，避免标题亚像素贴边；移动断点测量等待 Shell 响应式切换完成；双轮次断言修正选择器引号。新增模板顺序警告已修正，最终保留既有 V2 警告。没有删除旧断言或改业务 API 使测试通过。受控响应丢失用例的 socket hang up 为预期夹具行为。

## 风险及未验证

- 没有真实手机触控、屏幕阅读器、系统后台页签或 200% 高缩放验证。
- 未知旧历史为只读投影专项，不是生产旧档/真实迁移验证。
- 草稿/全部锚点/折叠/断点的交叉专项集中于面评；其余编辑器由各自真实业务回归保护，没有宣称穷举所有注入组合。
- L01/L02/L10 提供本轮实现与隔离证据，等待总控独立验收。正式 AC-01～AC-36 尚未全量验收。
- R03-D 摘要、统一历史时间线、R03-E 综合验收、REFINE-04 均未开始。不 Merge、不部署、不改目标分支/main。
