# 开发前历史来源矩阵

| 来源           | API/源码                                                         | 完整性                                            | 原始顺序          | 展开入口                                                                  |
| -------------- | ---------------------------------------------------------------- | ------------------------------------------------- | ----------------- | ------------------------------------------------------------------------- |
| 单条面评       | feedback-service.js history，interview-feedback-v3.js historyDto | feedbackId 的完整事件数组，无 LIMIT；不代表全申请 | aggregate_version | 原前后 V3FeedbackSnapshot、原提交人/时间、修订/豁免与决策关联             |
| 晋级           | advancement-service.js history，decision-v3.js                   | 该申请 stage_advanced 完整数组，无 LIMIT          | id                | 原阶段/目标、缺评清单、HR、原因、事件 ID                                  |
| Offer/结案     | offer-service.js history，decision-v3.js                         | 该申请允许事件类型的完整数组，无 LIMIT            | aggregate_version | 原前后 V3OfferState、原因来源、HR                                         |
| 单申请统一事件 | history-service.js applicationEvents                             | 升序游标分页，单页不完整                          | occurred_at,id    | 本轮不新增全域调用；原 readFeedbackHistory 仅对更正关联遍历游标的逻辑保留 |
| 面试表格       | 现有 interviews 查询                                             | 当前活动记录，不是改期等全事件链                  | 既有接口          | 保留原面试活动；不从当前状态生成事件                                      |

专用数组成功读完且时间/编号有效时，按 occurredAt,eventId 降序取本组最近三条（同时间 eventId 降序）。任何缺少排序字段的异常数组保持服务端顺序，仅称已加载摘要。失败/加载独立处理，绝不当空。旧版未核实历史不在专用新事件完整性承诺内。不得扩充 DTO 未授权字段。
