# HireFlow V3.0｜DOC-SYNC-03 阶段②后端完成与下一阶段集成边界 v1.0

> **文档状态**：DOC-SYNC-03 阶段文档定稿（`DEC-DOC-SYNC-03-START-01`）；正式同步须分别核验 GitHub 和 ChatGPT 项目来源，不代表 API、UI 或完整 AC 验收通过。\
> **修订日期**：2026-11-06；**权威依据**：冻结 PRD/MVP、总控 A 的 DEV 验收决议、GitHub 已核验 Commit。\
> **工作区**：`E:\FIFile\Documents\Codex\hireflow-v3`；**分支**：`feature/hireflow-v3`。\
> **DEV-10 后 GitHub HEAD**：`b0b84c21dec945f18db3c15e44cf0dd2737a1e9a`；**main**：`490b9ee2f1985b37052feebefd73605aa0dba1ab`，未合并。\

## 1. 阶段状态与证据性质

- **DEV-01～DEV-10：10/10 已分别由总控 A 完成代码验收、Git Commit/Push 与远程 HEAD 核验**。DEV-10 的最后一个正式关闭决议为 `DEC-DEV-10-CLOSE-01`。
- **累计自动化测试 102/102 通过、0 失败、0 跳过：来自 Codex 在隔离工作区执行 `pnpm test` 的报告**。总控 A 对任务源码、提交清单及 GitHub 分支作了核验，但未在用户 E 盘独立重跑 102 项测试。
- **V3 后端业务服务和数据库约束已经在隔离环境开发并验证，但尚未接入完整 V3 Express API / Vue UI；未执行正式 AC-01～AC-36 整套端到端验收，不代表 V3 产品已发布**。
- DEV-03 只涉及虚构 V2 数据和隔离迁移沙盒，**不代表生产数据库已迁移**。V2 `main` 和既有线上环境均未获准由 V3 工作改动。
- DOC-SYNC-03 是**文档同步节点**，本稿与 `AGENTS.md`/总纲须经 A 复核、单独授权 Git Commit/Push，再由 Owner 更新 ChatGPT 项目来源后关闭；**创建本文件不是自动完成同步**。

## 2. DEV 任务与可追溯提交

| DEV | 交付范围 | GitHub 已核验 Commit |
|---|---|---|
| DEV-01 | 初始化解耦与导入安全、隔离测试 | `6009bfaff9d6fdf306b6a8a63445f90d5f0c3b77` |
| DEV-02 | 严格 V3 Schema / 状态矩阵 / 约束 | `3e762313527a98021d72114b4a3ae25c8ae263c9` |
| DEV-03 | 虚构 V2 → V3 迁移沙盒、旧数据档案与恢复验证 | `5bfb2f436ba241bf37560f9e233b14e05be14f3c` |
| DEV-04 | 原子 Command Core / 事件 / 幂等 / 版本 | `4811360111825fbd501aa11f933cc3ddfcf3ec71` |
| DEV-05 | 职位与申请基础操作、招聘身份授权 | `e38d0e54c1029ffa7ada8a1a9cdf2a68a4377733` |
| DEV-06 | 面试计划、改期、完成、取消与上海时区 | `475105725396af1238b931ba0b68764753ecc40f` |
| DEV-07 | 面评首次提交与 HR 晋级/缺评豁免 | `39d425e9ff965e987a039006f9913b5ccb125747` |
| DEV-08 | 历史缺评补录与面评有痕更正 | `ce53924440caf942b74072a2d5414c80f1abf3ee` |
| DEV-09 | Offer 状态流转和招聘关闭 | `3d5216adbbb72c36dacca2554856882eafd28e80` |
| DEV-10 | Dashboard 统计、HR 待办、真实业务历史、旧档只读查询 | `b0b84c21dec945f18db3c15e44cf0dd2737a1e9a` |

DOC-SYNC-02 历史文档提交：`d1b3d67aca65148529a4de427d3ada25f6106e7f`。此次 DOC-SYNC-03 不修改过去的 Commit 历史。

## 3. DEV-10 结束时的真实后端边界

1. **数据模型与状态**：A+，一条 CandidateRecord 对应一次职位申请；`screening → first_interview → second_interview → offer`，`application_status`、`outcome`、`offer_status` 分离；严格 SQLite CHECK/FK、面试与反馈唯一性、活动预约约束。
2. **安全与执行语义**：可信 HR 身份校验、`BEGIN IMMEDIATE` 业务写事务、聚合版本与反馈 revision、幂等回执、不可变业务事件；候选人关闭后仅保留已提交面评有痕更正等正式例外。
3. **面试与决策**：预约/改期/完成/取消独立；面评和晋级独立；缺评可有理由晋级并留原事件与缺评关联；历史补录不改写原晋级；面评更正保存前后快照及真实操作者。
4. **Offer 与结案**：`preparing → sent → accepted`（接受并非录用）；`sent → declined` 与 `closed/offer_declined` 原子提交；`accepted → closed/hired` 须 HR 单独确认；企业淘汰/候选人退出保留阶段和 Offer 子状态；关闭前阻止任何仍 scheduled 的面试。
5. **Dashboard**：按真实职位/申请/面试记录分别统计，当前待办只看活跃申请和当前轮次；Offer 的 preparing/sent/accepted 互斥；录用仅 `closed + hired`；今日面试按 `Asia/Shanghai` 当日 `[00:00,次日00:00)` 的 scheduled_at 查询；提醒阈值 `now >= scheduled_at`，只读。
6. **历史查询**：查询不可变 `business_events`，按发生时间和事件 ID 稳定分页，保留聚合版本；晋级豁免、后补录、面评更正和关闭事实分别保留；未知旧档案不伪造时间、原因或事件。
7. **只读一致性**：Dashboard / History 用 `BEGIN DEFERRED` 和数据库内可信角色授权提供同次快照读取，未新增定时任务或人工写入统计结果。

## 4. 已确认的差异与遗留事项

| 事项 | 当前结论/边界 | 后续处理 |
|---|---|---|
| `status=open` 且软删除的职位 | Dashboard “开放职位”依冻结字面口径仍计入；`softDeletedOpen` 单独返回。此数**不等于可投递职位数**（职位选项排除 deleted_at 非空）。 | UI 明确指标文案；不擅改冻结 PRD。 |
| 今日面试明细 | DEV-10 返回整日真实记录，当前未提供分页。 | API/UI 集成时按真实目标数据量和性能另行评估。 |
| 旧档案读取 | 仅以 source_key/entity_type/legacy_id 精确读取；保留 history_unknown、导入时间与未知字段。 | API 入口及权限进一步定义；未核实旧记录不可混入活跃申请或事件时间线。 |
| 测试层级 | 已有 102 项隔离测试的 Codex 报告。 | API、端到端 UI、Figma 交互、真实迁移恢复、演示流程、AC-01～AC-36 需另行测试和记录。 |
| 生产与发布 | V3 未获准切换真实数据库、合并 main 或部署。 | 单独 Owner 批准，包含备份/回滚与发布门禁。 |
| 与旧 V2 API/UI 关系 | DEV-01～10 为 V3 隔离服务层能力；未宣称现有线上页面直接拥有全部新能力。 | 下一阶段首先明确 V3 API 合同与接入批次，再实现界面和 E2E。 |

## 5. 下一阶段建议路线（不是本轮授权）

- **DOC-SYNC-03**：本轮仅整理总纲、根目录 `AGENTS.md`、本技术摘要和 ChatGPT 来源《HireFlow项目说明》更新稿；先 A 审查，再单独 Git Commit/Push 与项目来源替换核验。
- **E3/API 准备**：先输出 V3 服务层到 Express API 的路由映射、授权/错误码、事务边界、查询与数据契约；在正式编码前由 A/Owner 审核授权。
- **E3/UI-01～UI-02**：按已批准 17 张 Figma 画板及设计规范实现 Dashboard、职位/申请/面试/面评/Offer/历史、表单和反馈态；C 设计走查，A 代码与业务验收。
- **E4/VERIFY**：逐项执行 AC-01～AC-36 的 API/UI/真实行为/数据库证据验收，随后再讨论部署及作品集交付。
- 若下一阶段计划改动被冻结的产品需求、MVP、设计基线、Schema 或生产数据，应**先走变更决策，不视为本同步文档自动授权**。

## 6. DOC-SYNC-03 核对与停止条件（流程清单，非实际完成状态）

- `docs/项目主控总纲.md` 升级 v1.6；各活动章节不再写 DEV-03 为下一任务，保留历史决策但标注历史。
- 根目录 `AGENTS.md` 对齐 v1.6、`b0b84c21`、102 项隔离测试与禁止自动进行 E3/部署的边界。
- 本摘要提交到 `docs/technical/`，不覆盖 E2-01 历史任务书。
- `HireFlow项目说明.md` 作为 ChatGPT 项目来源更新稿；**不要求擅自添加到 Git 仓库**。
- 保持 PRD v1.0、MVP v1.0、Figma 已验收规范原样；不得擅改业务源码、测试、Schema 或 V2。
- Codex 输出修改清单、纯文档 Diff、链接/路径与过期主动指令核对；A 审查通过后才另行授权 Commit/Push。
- GitHub 远程核验完成后，Owner 手动替换 ChatGPT 来源；两端检查一致后再关闭 DOC-SYNC-03。
