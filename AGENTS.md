# HireFlow 项目协作规范

> DOC-SYNC-04 阶段同步草案；仓库、GitHub 和 ChatGPT 项目来源的同步状态需分别核验。

## 项目、工作区与当前事实

- 定位：面向小型企业或小型招聘团队的企业招聘流程协作平台，不转为个人求职追踪工具。
- 保留技术栈：Vue 3、TypeScript、Pinia、Vue Router、Axios、Element Plus、ECharts、Vite、Sass；Node.js、Express、JWT、bcryptjs、SQLite（`node:sqlite`）。
- **唯一正式 V3 本地工作区**：`E:/FIFile/Documents/Codex/hireflow-v3`。C 盘旧工程仅是历史资料，不能用于当前开发。
- **开发分支**：`feature/hireflow-v3`，E3 合并基线 `8c02262cb4dc1dcb283c24ca967926567dbdd8fe`；V2 `main` 基线 `490b9ee2f1985b37052feebefd73605aa0dba1ab`。
- **当前总纲**：`docs/项目主控总纲.md`；E3/E4 边界见 `docs/technical/HireFlow_DOC-SYNC-04_E3完成与E4集成边界_v1.0.md`。
- **已验收任务**：S1-01～03、D1-01/02、E2-01、DEV-01～DEV-10。代码均已由总控 A 分批验收且 GitHub 提交链核验，**阶段②后端隔离研发批次 10/10 完成**。
- Codex 本地隔离回归报告六业务 Chromium 通过、`pnpm test` 196/196；不是 GitHub CI 或总控亲自重跑，正式 AC-01～AC-36 未验收。
- E3 API/UI 与 REFINE-01～04 已集成；E4 是下一阶段，但尚未授权执行。任务、Git 提交、推送、合并与部署均需相应明确授权。

## 已冻结基线与已验收实现边界

- Owner 于 2026-11-02 冻结 PRD v1.0、MVP 验收清单 v1.0：**A+ 一申请一 CandidateRecord**；四阶段 `screening → first_interview → second_interview → offer`；`application_status` / `outcome` / `offer_status` 独立；10 P0 / 6 P1，不得擅改。
- 设计基线为已验收 D1-02 UI 规范和 Figma <https://www.figma.com/design/5SnNs9DASMJdq3rvJXc37U>，17 张编号画板 00～16；竞品仅作辅助参考；`docs/images/` 是须保留的 V2 历史视觉资料。
- DEV-01～10 已完成的**隔离后端能力**：Schema/迁移沙盒、可信 HR 身份与 Command Core/幂等、职位与申请、面试独立活动、面评提交/历史补录/有痕更正、柔性晋级与真实事件、Offer 与结案、Dashboard 六类待办及上海时区、申请/职位真实历史与未知旧档读取。
- V3 API/UI 已在 E3 集成；未合并 V2 main、未部署生产、未执行正式生产迁移。
- Dashboard “开放职位”采用冻结 `status='open'` 字面口径，`softDeletedOpen` 单列；不能与排除软删除的可投递职位选项混称。旧轮历史缺评不计当前待面评；active+accepted 不等于 hired；今日按上海 `[00:00, 次日00:00)`，到时提醒为 scheduled 且 `now >= scheduled_at`，均只读。
- 旧档历史未知事实不可伪造；DEV-03 迁移仅对虚构数据和受控隔离库测试过，**不允许因此操作生产 SQLite**。

## 文档入口与优先级

- **开始任务先看** `docs/项目主控总纲.md` 的版本、当前决议及本任务单；技术实施细节再看实际 HEAD 源码。总纲是调度资料，**不是测试结果或 API 合同**。
- 最新经 Owner 确认的具体决议 > 冻结 PRD/MVP / 已验收 UI 规范 > 已验收技术方案 > 当前总纲的进度调度 > 早期研究和历史任务书；冲突必须报告，不自行纠正需求。
- 常用资料：
  - `docs/research/01-项目现状与功能盘点.md`、`02-竞品研究.md`、`R04-数据模型A_B对比研究.md`（早期研究）。
  - `docs/product/03-招聘业务流程与状态规则.md`、`PRD-V3.0_v1.0_正式冻结版.md`、`V3.0-MVP验收清单_v1.0_正式冻结版.md`。
  - `docs/design/HireFlow_D1-02_UI_Design_Spec_v1.0_Approved.md`、`HireFlow_D1-02_AC01-AC36_UI承载对照_v1.0_未测试.md`。
  - `docs/technical/HireFlow_E2-01_技术方案阶段启动任务书_v1.0.md`（历史背景）和 `HireFlow_DOC-SYNC-03_阶段二完成与集成边界_v1.0.md`（历史阶段摘要）。
- 不要求每轮阅读全文；缺少关键文件时须报告，不以聊天记忆替代源码/冻结文件。不能将历史研究、旧任务书的未决或旧 C 盘路径当作当前授权。

## 协作与执行权限

- 对话 A 负责项目总控与源码验收；B 负责产品研究与冻结规则解释；C 负责 UI/UX 走查；Owner 最终确认重要取舍；Codex 只执行 A 明确派发的单批工作。
- 当前文档同步范围以 DOC-SYNC-04 任务为准；ChatGPT 项目来源需 Owner 独立核验与替换。
- 保持冻结 PRD/MVP、设计规范及既有业务规则；未经明确任务授权不修改业务源码、测试或 Schema。
- 工作流：明确授权 → Codex 在本机只修改授权文件 → 静态核对/差异审查 → 按任务授权创建审查分支及 Draft PR → 总控 A 独立验收 → Owner 针对固定 PR 和 SHA 单独授权合并 → GitHub 远程核验 → Owner 再替换 ChatGPT 项目来源。**任一步都不视为自动完成下一步。**
- 下一阶段为 E4 正式综合验收，尚未授权；不得自动开始。

## 生产、Git 与安全

- 禁止未经单独批准的 `git add`/commit/push、main 合并/强推、生产部署、生产库备份/覆盖/迁移、旧 `reset-db`、测试数据写入真实库、机密或真实候选人数据读取与公开。
- 迁移/恢复必须显式授权，遵循隔离、备份/WAL/SHM 与核对/回滚要求；DEV-03 工具测试不等于正式部署许可。
- 网络与凭据只使用本次经核验的临时代理/现有合法凭据，不将代理端口写死、不关闭 SSL 验证、不输出凭据、不永久修改全局 Git 设置。
- 保留开源上游与 MIT / `THIRD_PARTY_NOTICES.md` 声明；不编造性能改善、用例成功或验证结论。
- 本次输出修改文件清单、差异摘要、静态/链接检查、当前 Git 状态和剩余风险，等待 A 下一步授权。

- 保留真实操作者、不可伪造历史、事务与幂等、版本并发保护、编辑器互斥和草稿隔离；R04-UX-RISK-ZOOM-01 的原生 200% 缩放、真机、读屏仍待验证。
