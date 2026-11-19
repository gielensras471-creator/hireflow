# HireFlow 项目协作规范

HireFlow 是面向小型招聘团队的招聘流程协作平台。前端使用 Vue 3、TypeScript、Pinia、Vue Router、Element Plus、Vite 和 Sass，后端使用 Node.js、Express、JWT、bcryptjs 和 SQLite。公开 Demo 的安装、构建和启动命令见 [README](README.md)。

## 当前版本与工作区

- V3 已完成验收和冻结。GitHub main 的稳定基线是 52a0fb22f51ddcd335c2635d9d65dba664708f60，来自 PR #12。公开展示使用 [腾讯云 Demo](https://demo.pixelweave.xyz/)。正式 API 使用独立数据和认证。原 Render 站点按 Owner 决策保留原状、停止同步。
- V4 尚未启动。仅在 Owner 授权后从冻结 main 建立同仓库的独立分支和 Git Worktree。主控资料由 E:/FIFile/Documents/Codex/HireFlow/docs 维护。工程验证与权限约束沿用下文。

## 开发依据

- 以 Owner 当前批准的任务范围和冻结业务规则为准。改动前核对实际分支、HEAD 和工作树状态。
- 招聘逻辑参照 [业务流程与状态规则](docs/product/03-招聘业务流程与状态规则.md)、[冻结 PRD](docs/product/PRD-V3.0_v1.0_正式冻结版.md)和 [MVP 验收清单](docs/product/V3.0-MVP验收清单_v1.0_正式冻结版.md)。保留 [R04 数据模型论证](docs/research/R04-数据模型A_B对比研究.md)供追溯，业务规则以冻结 PRD 为准。
- 视觉改动参照 [D1-02 批准版设计规范](docs/design/HireFlow_D1-02_UI_Design_Spec_v1.0_Approved.md)、[D1-01 设计依据](docs/design/D1-01-视觉参考与信息架构研究_v1.0_已验收.md)和 [Figma](https://www.figma.com/design/5SnNs9DASMJdq3rvJXc37U)。
- 正式模式的配置边界见 [V3 运行说明](docs/operations/v3-local-production.md)。涉及业务规则时核对前后端一致性并验证受影响的流程。

## 业务与测试边界

- 一份申请对应一条 CandidateRecord。申请状态、结案结果和 Offer 状态分别记录。面试完成或面评提交后由 HR 独立决定晋级，Offer 接受后由 HR 独立确认录用。
- 工作台沿用冻结统计口径和上海时区。开放职位统计按 `status='open'` 计算，软删除的开放职位单列。旧轮历史缺评与当前待面评分别计算，到时提醒保持只读。
- 保留真实操作者、事件和回执、事务、幂等、版本并发保护及草稿隔离。旧档的未知事实保持未知。
- Demo 测试使用虚构数据和独立内存 SQLite。验证记录应说明实际运行的命令和结果。

## 协作和操作权限

- A 负责任务范围和验收，B 负责产品规则，C 负责设计。Codex 按批准范围改动并交付文件清单、验证结果和未解决事项。
- Git 暂存、提交、推送、合并和部署分别遵守本轮明确授权。环境变更、生产数据操作、生产凭据访问和破坏性操作需要单独批准。
- 保持正式环境与公开 Demo 隔离。使用获准的代理和现有合法凭据，保持 TLS 校验，避免记录密钥或改动全局 Git 配置。
- 保留 [MIT 许可](LICENSE)、[第三方声明](THIRD_PARTY_NOTICES.md)和 `docs/images/` 中的项目截图。
