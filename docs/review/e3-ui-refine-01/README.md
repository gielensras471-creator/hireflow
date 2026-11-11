# E3-UI-REFINE-01 审查

授权 DEC-E3-UI-REFINE-01-START-01。Base c0c5ce09084b8c16a7199ac6a45bbc18f783f0e5；review/e3-ui-refine-01 → feature/hireflow-v3。

## 实际改动

- REFINE-001：补齐企业淘汰/候选人退出映射；未知值显示“未知，待核实”；申请列表结果和 Offer 在同单元格分别标注；晋级事件及 Dashboard 开放统计改用中文。原始枚举未修改。
- REFINE-002：申请阶段/状态和面试状态增加文字标签；冲突区域读取最新事实为主操作，原重提与取消入口保留。禁用条件未改。
- REFINE-003：五编辑器增加统一业务冲突摘要与未决风险提示；版本与服务器当前值对照保留。原 Key、原内容、人工确认、409/403及租约机制未改。
- REFINE-004：申请空态文字优化，Dashboard 使用实际 items 数计算范围；面试取消原因仅清除已经消除的本地空值错误，冲突、未决和其他错误不清除。

文案对照见 copy-action-matrix.md。详情排序、历史折叠、横滑提示、筛选识别、手机指标布局及动效保留至后续授权批次。不是全站视觉重做；不自行宣布设计通过或正式 AC 通过。

## 实际验证

pnpm test：184通过/0失败/0跳过（新增3项执行实际映射和局部校验函数的回归）。vue-tsc --noEmit通过。lint 0错误、1个既有V2属性顺序警告。build通过。Prettier与diff检查见交付结果。

六批实际Chromium：recruiting、interviews、feedback、advancement、offer、dashboard全部通过，见各子目录results.json和真实截图。原181项业务回归保留，原有安全断言仅适配受改文案；Dashboard新增末页21–22条断言。最终标签改动后重新运行recruiting和dashboard。

## 证据索引

- recruiting/applications.png、applications-mobile.png：独立状态与桌面/手机。
- recruiting/operation-403.png：有效会话操作拒绝。
- recruiting/conflict-409.png：草稿保留及读取/确认操作。
- recruiting/uncertain-write.png：未决风险和原请求重试。
- recruiting/positions-empty.png、applications-filtered-empty.png、applications-error.png：空库/无匹配/错误。
- interviews：面试状态、双版本、取消原因、真实互斥与失败读取保护。
- feedback：更正前后快照、冲突、关闭后更正和未决重放。
- advancement、offer：独立决策、确认语义、幂等和写入中离开保护。
- dashboard/dashboard-last-page.png：真实末页范围；dashboard-first-screen.png与dashboard-mobile.png：统计单位、上海时区与响应式。

截图均由真实Express V3、内存SQLite、随机虚构HR与Chromium产生。故意丢失响应测试的socket hang up为预期故障注入，不是未处理回归失败。没有真实候选人、凭据或数据库提交。

## 未验证和保留范围

没有真实手机、屏幕阅读器或生产验证；局部取消校验以执行源码函数的Node测试验证，不冒称独立Chromium校验场景。未知历史映射由Node实际函数测试覆盖，未新增旧档浏览器入口。事件版本等技术信息仍保留，可在未来授权中调整辅助层级。申请详情结构和历史长度未变。

未修改后端API、状态机、Schema、共享认证、写入意图、租约、草稿机制、V2或冻结资料。完成后保持Draft，等待A源码和03设计验收，不合并。
