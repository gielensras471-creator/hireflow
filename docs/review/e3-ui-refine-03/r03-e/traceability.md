# R03-A～E / L01～10 / T01～18 追踪矩阵

所有“本轮”指 r03-e 下实际新运行结果。覆盖是隔离场景，不代表正式 AC 或设备验收。

| 切片 | 实现/本轮证据                                                                                                                            |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| A    | V3Recruiting 稳定 selected/key/Gate；feedback/r03-lifecycle.json、r03-real-save.json、r03-write-evidence.json、刷新失败/恢复及跨账号截图 |
| B    | 父页摘要/双栏，feedback/r03b-layout.json、三域 r03b-summary-matrix.jsonl，四状态/accepted 分离                                           |
| C    | 页内导航、只读折叠/当前轮次，feedback/r03c-keyboard-lifecycle.json                                                                       |
| D    | 三领域历史、feedback/r03d-history.json、七条快照/503/403与原状态分离                                                                     |
| E    | 安全时间函数/实际模板测试；长原因+历史草稿+父刷新组合 r03e-history-draft-parent-refresh.png                                              |

| 门禁 | 可重复入口与证据                                      | 范围                         |
| ---- | ----------------------------------------------------- | ---------------------------- |
| L01  | C 专项每个导航前后 location.href、UID                 | 不变 URL/hash/query          |
| L02  | C 只读折叠 + D 历史折叠草稿                           | 不隐藏或卸载编辑器           |
| L03  | C/D 390/1100/1440 UID、草稿                           | 同一四面板实例               |
| L04  | Feedback/Offer/Advancement 原 Key/正文/事件计数       | 未决与重放本轮回归           |
| L05  | 三编辑器 409 最新事实与人工确认                       | 本轮各业务脚本               |
| L06  | 业务操作级403、历史GET403与撤权/401                   | 本轮六批及 D 专项            |
| L07  | 双方向延迟打开、active editor数量                     | 原 Gate 保留，六批重跑       |
| L08  | A 成功/失败/排队/恢复 + E 历史草稿中父刷新            | 保存后 UID 保持              |
| L09  | A 延迟父响应跨申请/账号、六批身份回归                 | 历史各来源独立迟到组合未穷举 |
| L10  | C Tab/Shift+Tab/Enter/Space/Esc + D 原生历史/焦点恢复 | 真实 CDP；读屏未执行         |

| 验收项 | 本轮实际证据与状态                                                                 |
| ------ | ---------------------------------------------------------------------------------- |
| T01    | B/C 摘要截图及三域实际状态矩阵；通过隔离断言                                       |
| T02    | r03b-layout.json、layout-1100.png；同实例下沉                                      |
| T03    | C 390 顺序/尺寸、长资料，D 长原因；无新增整页溢出                                  |
| T04    | C 原始资料全文/空值、聚焦区域收起恢复，草稿保持                                    |
| T05    | D 0/1/3/4/7、原事件 ID；不冒充全域最新                                             |
| T06    | 部分：七条面评/六次更正全部展开核对；未新增10+单来源样本或统一事件分页终点综合测试 |
| T07    | C 旧版未知只读投影，SSR异常字段；D GET503/403/重试                                 |
| T08    | Feedback 实际豁免、后补录、原关联不变                                              |
| T09    | Offer preparing/sent/accepted/declined、hired和普通结案脚本                        |
| T10    | C 六导航/资料折叠/断点，D历史与E父刷新草稿组合                                     |
| T11    | Feedback/Advancement/Offer 实际并发409，人工确认                                   |
| T12    | 六批403/401/撤权，D历史操作级403                                                   |
| T13    | 同 Key/同正文且事件/回执一次效果，本轮计数                                         |
| T14    | Gate互斥、A真实保存updated、E排队刷新                                              |
| T15    | 部分：跨申请/账号父迟到读与六批隔离通过，未穷举每个历史GET独立延迟组合             |
| T16    | C/D真实键盘与焦点通过；屏幕阅读器未执行                                            |
| T17    | 本轮Loading/Empty/Error/Retry、异常时间实际模板与纯函数                            |
| T18    | 六份新 results.json，零V2请求；不是旧结果复制                                      |

每批执行 node tests/browser/v3-<suite>.mjs docs/review/e3-ui-refine-03/r03-e/<suite>；Feedback 另设 R03_A/B/C/D/E=1。脚本准备数据只在全新隔离内存库。
