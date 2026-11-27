# HireFlow 项目协作规范

## 当前版本

HireFlow 是面向小型招聘团队的流程协作平台。V4.0.0 已在腾讯云正式发布并通过 Owner 线上验收，集中开发结束，进入低频维护。V5 尚未启动，新增重大功能、产品范围变更或新版本研发须经 Owner 明确授权。

- [GitHub Release v4.0.0](https://github.com/gielensras471-creator/hireflow/releases/tag/v4.0.0) 对应部署源码 `4c63b87c4678d40c57e6227798a3e75f8777af4b`。后续文档提交可推进 main，线上版本以实际部署 SHA 核验。
- [正式前端](https://hireflow.pixelweave.xyz/) · [正式 API](https://api.pixelweave.xyz/api/v3) · [公开 Demo](https://hireflowdemo.pixelweave.xyz/)。旧 Demo 域名保留 HTTPS 301，Render 属于历史环境。
- 开工前核对工作树、分支与 HEAD。现行项目管理资料位于 `E:/FIFile/Documents/Codex/HireFlow/docs`，历史工作树和归档保留供追溯。

## 设计与业务依据

- 视觉以 [V4.1 最终签收 Figma](https://www.figma.com/design/eezdpmBtn9Nj4KSQjmUtLI) 及最终画板索引为准。V3 D1-02 保留作历史参考。
- 运行与工程依据为 [V4 运行维护](docs/operations/V4运行维护.md)、[技术架构](docs/architecture/V4技术架构.md)、[接口合同](docs/architecture/V4接口合同.md) 与 [数据库设计](docs/architecture/V4数据库设计.md)。
- 招聘规则以 [V3 冻结 PRD](docs/product/PRD-V3.0_v1.0_正式冻结版.md)、[AC-01～36](docs/product/V3.0-MVP验收清单_v1.0_正式冻结版.md) 和 [业务流程与状态规则](docs/product/03-招聘业务流程与状态规则.md) 为准。[R04 数据模型论证](docs/research/R04-数据模型A_B对比研究.md) 保留供追溯。
- 一份职位申请对应一条 CandidateRecord。招聘四阶段、申请生命周期、招聘结果与 Offer 状态分别记录。面试完成或面评提交后由 HR 独立决定晋级，Offer 接受后由 HR 独立确认录用。
- 工作台沿用冻结统计口径和 Asia/Shanghai。开放职位按 `status='open'` 统计，软删除开放职位单列。旧轮历史缺评与当前待面评分开，到时提醒保持只读。
- 保留真实操作者、事件回执、事务、幂等、版本并发保护与草稿隔离。旧档未知事实保持未知，区分历史覆盖不足与真实零值。

## 维护和权限

- Owner 授权并最终验收，ChatGPT 总控明确范围与验收标准，Codex 执行、验证和归档。根据变更范围选择必要验证。小型文档或样式修改只做适用的差异、链接或定向检查。业务、认证、依赖或发布变更补齐受影响的回归。记录实际结果与待验证事项。
- Git 暂存、提交、推送、合并、打标签和发布按本轮明确授权执行。部署、线上配置、生产数据或凭据访问、备份、恢复、迁移和破坏性操作需单独批准。保留已发布标签与历史证据。
- 正式与公开 Demo 分开存储、认证和运行。调试与测试使用隔离环境及虚构数据。保持 TLS 校验和合法的临时代理，不输出或提交生产凭据、私钥、令牌、真实数据或未脱敏日志。禁止擅改全局 Git 配置。
- 保留 [MIT 许可](LICENSE)、[第三方声明](THIRD_PARTY_NOTICES.md)及历史截图。
