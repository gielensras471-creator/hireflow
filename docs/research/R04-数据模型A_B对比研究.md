# HireFlow V3.0｜R04 数据模型 A/B 对比研究（讨论稿）

- 日期：2026-10-30
- 项目基线：V2.1.1，提交 `490b9ee2f1985b37052feebefd73605aa0dba1ab`
- 阶段：产品研究与需求设计；**非 PRD 定稿、非 MVP 冻结、非开发指令**
- 对话责任：02｜V3.0 产品研究与需求分析
- 本次未修改源码、数据库或生产环境。

## 一、主控依据及确认决策

依据《HireFlow_V3.0_项目主控总纲_对话调度版.md》v1.0：保留企业招聘流程协作平台定位、Vue3/TypeScript/Express/SQLite 架构；以可解释的真实招聘业务为核心；不无理由迁移数据库；重要决策须用户批准并回总控对话验收。

已确认：
1. 招聘阶段、面试状态、面评、招聘决策分离。
2. 面评未齐时采用柔性校验：HR 可说明原因推进，系统保留缺失提示与特殊操作记录。
3. HR 为主要用户，兼顾面试官和用人经理协作；不据此承诺复杂 RBAC。

## 二、V2.1.1 已核验的事实（静态源码）

1. `server/db/database.js`：主要业务表 `users/positions/candidates/interviews`；`candidates` 同时保存身份信息、职位名称、阶段及投递日期；`interviews.candidate_id` 外键到 `candidates.id`。
2. `server/routes/candidates.js`：按职位名称更新 `positions.candidate_count`；候选人阶段 `screening/first_interview/second_interview/offer/rejected`。
3. `server/routes/positions.js`：职位可以同名；编辑职位名称按旧名称批量更新候选人及面试文本字段；删除职位不要求先处理相关申请。
4. `src/config/recruitment.ts` 和 `src/views/interviews/index.vue`：初面完成时自动进入复面、复面完成时自动进入 Offer；完成面试和修改候选人阶段分别通过请求执行。
5. `src/views/candidates/index.vue`：安排初面时可能自动把筛选阶段改为初面；候选人表单的职位下拉值是写死的名称。
6. `src/views/candidates/detail.vue`：招聘进度线由当前阶段推断，而非真实事件记录。
7. `src/views/dashboard/index.vue`：待办数计算为待筛选候选人数加已安排面试数。

证据为仓库指定提交的源码，不代表已完成本地运行验收。主要链接：
- https://github.com/gielensras471-creator/hireflow/blob/490b9ee2f1985b37052feebefd73605aa0dba1ab/server/db/database.js
- https://github.com/gielensras471-creator/hireflow/blob/490b9ee2f1985b37052feebefd73605aa0dba1ab/server/routes/candidates.js
- https://github.com/gielensras471-creator/hireflow/blob/490b9ee2f1985b37052feebefd73605aa0dba1ab/server/routes/positions.js
- https://github.com/gielensras471-creator/hireflow/blob/490b9ee2f1985b37052feebefd73605aa0dba1ab/src/config/recruitment.ts
- https://github.com/gielensras471-creator/hireflow/blob/490b9ee2f1985b37052feebefd73605aa0dba1ab/src/views/interviews/index.vue

## 三、两种模型的定义

### A｜最小改造：单条 Candidate 记录代表某职位的一次申请

概念（名称仅用于产品研究）：

- `Position(id, title, ...)`
- `CandidateRecord(id, position_id, name, contact, stage, application_status, outcome, applied_at, ...)`
- `Interview(id, candidate_record_id, type, status, schedule, ...)`
- `Feedback(id, interview_id, reviewer, recommendation, evidence, submitted_at, ...)`
- `Event(id, candidate_record_id, action, actor_id, occurred_at, reason, ...)`

特点：不单独存放复用型 Candidate 身份表；同一个人投两个岗位，会形成两条候选人申请记录，并各自保存姓名、联系方式和招聘状态。`candidate_record_id` 是概念称谓，实际是否继续使用现有 `candidates.id` 待技术设计确认。

### B｜适度重构：Candidate 身份与 Application 职位申请分离

- `Candidate(id, name, contact, background, ...)`
- `Position(id, title, ...)`
- `Application(id, candidate_id, position_id, stage, application_status, outcome, applied_at, owner, ...)`
- `Interview(id, application_id, type, status, schedule, ...)`
- `Feedback(id, interview_id, reviewer, recommendation, evidence, submitted_at, ...)`
- `Event(id, application_id, action, actor_id, occurred_at, reason, ...)`

特点：同一个 Candidate 可以对应多个职位申请，每次申请独立拥有阶段、面试、评价、结果和事件。候选人身份不应简单凭姓名或电话号码自动合并；需要唯一标识、重复档案核实与合并策略。

两种模型都应保持：招聘阶段与申请生命周期结果分离；面试完成与晋级分离；业务操作由后端校验；保存真实事件；按稳定职位 ID 关联；统计口径清楚。

## 四、同一业务案例的结果

场景：张三分别应聘前端实习岗与 UI 设计岗；前端初面通过、UI 岗主动退出，前端后来改期复面。

- A：两条候选人记录，职位关联与面试历史分别完整；但修改张三电话要同时维护两条记录，或容忍重复个人资料。前端与 UI 的进展能够分开，不需要独立 Application 表。
- B：一个 Candidate，两个 Application；电话只修改个人档案；每个申请仍分别关联面试、历史及结果。需要更复杂的查询和路由语义。

场景：李四只申请一个职位，经过筛选、初面、复面、Offer。

- A、B 均可完整准确处理；B 的多表结构不会自动带来额外业务价值。

场景：企业淘汰后恢复申请。

- A：恢复同一个候选人申请记录，保留历史；B：恢复对应 Application 并保留历史。两个模型的业务能力相同。

## 五、差异比较

| 维度 | A 最小改造 | B 独立 Application |
|---|---|---|
| 单岗位招聘业务闭环 | 可以完整支持 | 可以完整支持 |
| 同一人多职位独立进展 | 可以，但重复存储个人资料 | 原生支持 |
| 跨职位共享个人档案 | 不自然，容易不同步 | 原生支持 |
| 修改现有路由/类型/Store 的范围 | 相对小 | 相对大 |
| 旧数据迁移和回滚压力 | 中 | 中高 |
| 需要解决同名岗位关联 | 是 | 是 |
| 需要新增面评与事件历史 | 是 | 是 |
| 需要拆分招聘阶段与结果 | 是 | 是 |
| 需要重做可靠统计口径 | 是 | 是 |
| 需要处理重复候选人身份 | 可以暂不合并 | 若跨职位复用身份，必须研究 |
| 对前端实习作品展示价值 | 已足以展示闭环设计 | 可更完整讲解关系建模，但测试成本更高 |

以上成本均为相对估计，未做本地运行、迁移演练或工时核算。

## 六、不能错误归因给 B 的收益

以下问题都能在 A 中解决，不足以单独作为选择 B 的理由：
- 面试完成不自动晋级；
- 面试评价和招聘决策独立；
- 面评未齐时柔性提醒并记录原因；
- `position_id` 稳定关联职位；
- 阶段历史、终止原因和事件审计；
- 取消/改期及异常处理；
- 真实 Dashboard 指标和待办；
- 事务与后端业务校验。

B 的独特收益主要来自**可复用的候选人身份**与**多个职位申请的独立生命周期**。

## 七、两者共同必须明确的状态与数据口径

建议概念上分离：
- `stage`: screening / first_interview / second_interview / offer；
- `application_status`: active / closed（或更详细但需要确定语义的状态）；
- `outcome`: hired / company_rejected / candidate_withdrew / offer_declined / other（仅候选枚举，尚未冻结）；
- `interview.status`: scheduled / completed / cancelled（是否增加 no_show、re-schedule 事件另行评估）；
- `feedback.recommendation`: recommend / not_recommend / undecided（仅示例）；
- `decision`: advance / reject / hold / restore（事件动作示例）。

Offer 是阶段还是具体审批过程，不能把“进入 Offer 阶段”直接认定为“已发 Offer”或“正式录用”。

建议统计口径讨论：职位申请数应按申请记录计数，去重候选人数按候选人身份统计（只有 B 有自然结构）；待办应按照工作项类型拆分，避免将多个待办合计伪装成不同候选人的数量。

## 八、迁移与一致性风险

A 的迁移建议（研究性）：
1. 在测试副本列出旧职位名称与职位 ID 的映射；
2. 若匹配唯一，则补 `position_id`；若无匹配或多条同名，进入人工审核，不猜测；
3. 为现有 `rejected` 数据保留终止状态并标记来源为旧版，**不得伪造淘汰时的历史阶段与原因**；
4. `candidate_count` 采用按外键关联的计算口径，旧缓存值不能作为真值；
5. 增加事件记录后只记录之后真实发生的业务事件。

B 的额外迁移建议（研究性）：
1. 每条旧 `candidates` 记录首先映射为一条 Candidate 身份 + 一条 Application（避免擅自合并）；
2. 记录 `legacy_candidate_id -> application_id` 映射，逐条迁移面试外键及旧关系；
3. 再决定是否通过审核进行候选人档案合并，不凭姓名、手机号或邮箱自动去重；
4. 检查相同身份多申请时的资料更新和权限可见性；
5. 检验接口、列表、详情路由和统计是否按照 Application 还是 Candidate 聚合；
6. 保留可回滚副本与迁移前后记录数/关联检查；上线迁移须在 A 对话单独审查批准。

尚未读取本地审计文件与实际 SQLite 数据，不能断言迁移工作量或数据质量。

## 九、业务验收案例（拟）

- C01：面试完成不自动晋级；HR 决策才推进，事件可追溯。
- C02：面评未齐时先提示缺失、允许理由推进，不能产生假的通过评价。
- C03：两个同名职位，各自人数和关联准确。
- C04：职位改名不影响已有申请。
- C05：候选人主动退出与企业淘汰分别记账，保存终止阶段信息。
- C06：历史事件记录动作、账号、时间及必要原因；不能通过当前状态倒推伪造历史。
- C07：单个申请可以经历多次预约、取消或改期，招聘阶段不受误触发。
- C08：同一个人申请两岗，各自阶段与结果互不污染（A 可以用两条人岗记录，B 用一人两申请）。
- C09：同一人跨职位修改联系方式后保持一致（B 天然具备；A 若要求实现则需要额外机制）。

## 十、判断界线与建议

**倾向：先以 A+（在 A 上补全稳定关联、阶段结果、面评、事件、后端校验）作为最小可信闭环的比较基线；如果 R03 的真实场景确认“同一人多岗共享个人档案和跨岗位历史”是 V3.0 必需能力，再优先选 B。**

这不是决定最终采用 A，也不是否认 B 的合理性，而是防止“表结构更规范”被误当成独立业务收益。若决定采用 B，需在 PRD 中写清由该模型承载的最少一个真实核心用例，以及可控的迁移计划。

待用户/总控进一步确认的产品问题：
1. V3.0 是否要把“同一候选人投递不同职位、共享一份基本档案”作为必须演示的核心场景？
2. HireFlow 的“候选人列表”实际更像“职位申请列表”，页面产品术语如何确定？
3. 何时应区分“重新申请同一职位”和“恢复此前已终止的申请”？

## 十一、节点调度

本文件为 R04 研究材料，不代表 S1-01/S1-02 已被 A 验收。应依据主控总纲第 7 节提交摘要，回 A 审核正式研究成果；PRD / MVP 冻结必须由 A + 用户批准。下一步仍归本对话的产品模型研究范围，不进行代码与设计开发。
