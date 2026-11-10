# E3-UI-04A 招聘决策与阶段晋级审查证据

授权：DEC-E3-UI-04A-START-01。仅提交 Draft PR 供总控 A 源码验收与对话 03 设计复核，不代表正式 AC 全部通过或 Merge 授权。

## 基线与实现范围

- Base：0e4cb2f847c30e73347732b6268f121283aef9b0；审查分支 review/e3-ui-04a，PR base 为 feature/hireflow-v3。
- 保护 main：490b9ee2f1985b37052feebefd73605aa0dba1ab。
- V3Recruiting.vue 仅接入决策组件并移除“晋级尚未接入”旧提示。
- advancement-v3.ts：预检 / 历史 DTO、可操作门禁、原转换意图比较及预检完整事实摘要。
- V3AdvancementPanel.vue：四阶段位置、独立生命周期、服务器资格、真实晋级历史；异步打开前取得共享租约，读取后核对身份 / 路由 / 生命周期 / 租约。
- V3AdvancementFacts.vue：预约、完成、取消计数，全部缺评 ID、真实评价结论 / 专家 / 依据，预约硬阻断。
- V3AdvancementEditor.vue：提交前新预检、明确确认、必需理由、冲突保留理由及原目标保护、原 Key 原内容未决重试。
- 未修改后端 API / Command Core / Schema / 业务状态机，不实现 Offer 命令、普通申请关闭或 Dashboard UI。
- Figma 11 已用 MCP 实际读取并核对异常卡片、语义提示及次左主右动作；复用已批准的申请详情骨架、Shell 与响应式策略，未重构整个详情。

## 实际验证

| 命令                                                 | 实际结果                                                                    |
| ---------------------------------------------------- | --------------------------------------------------------------------------- |
| pnpm test                                            | 176 通过、0 失败、0 跳过；新增 3 项晋级门禁 / 原转换意图 / 预检事实比较测试 |
| pnpm exec vue-tsc --noEmit                           | 通过                                                                        |
| pnpm lint                                            | 0 错误，1 个既有 src/views/dashboard/index.vue 属性顺序警告                 |
| pnpm build                                           | 通过，仅本地构建                                                            |
| 变更文件 Prettier 检查、git diff --check             | 通过                                                                        |
| node tests/browser/v3-advancement.mjs <外部输出目录> | 9 组实际 Chromium 场景通过，详见 results.json                               |
| node tests/browser/v3-feedback.mjs <外部输出目录>    | UI-03B 回归通过                                                             |
| node tests/browser/v3-interviews.mjs <外部输出目录>  | UI-03A 回归通过                                                             |
| node tests/browser/v3-recruiting.mjs <外部输出目录>  | UI-02 回归见 regression-ui02-results.json                                   |

环境：Windows Chrome、Node v24.17.0、既有依赖。各脚本新建 V3 内存 SQLite、随机虚构 HR 密码 / JWT、loopback API / Vite；串行执行，自动关闭自己创建的服务及 Chromium。所有截图仅含虚构资料，不保存凭据、数据库或生产数据。

开发期纠正两项测试断言：后端非法跳轮真实状态码为 422；node:sqlite 返回行使用无原型对象，计数比较需规范化。最终完整运行通过，未为测试改变产品后端。

## 关键安全与真实业务证据

1. 三次独立 HR 确认依次 screening → first_interview → second_interview → offer，最终 preparing 取自服务器。完成面试和提交 recommend 均保持原阶段。
2. 多场面试缺评清单包含全部 ID；not_recommend 真实可见但不自动否决 HR 决定。缺评 / skip_evaluation 均要求非空理由，scheduled 无法用理由绕过。
3. 提交前获取新预检。若版本或任何资格事实变化，保留理由，停止发送并要求重新确认。409 后如原 from/to 已变，禁用旧意图继续提交，不把初面决定重解释为复面 → Offer。
4. 写入全部复用 writeV3 / createWriteIntent 与现有服务端原子事务。丢失成功响应后重试保留同 Key、同业务内容和原 expectedVersion；只产生一次事件和回执。快速重复点击不会连续晋级。
5. 四编辑器共享 editorGateKey；在请求开始前互斥，等待子组件卸载后释放自己的租约。延迟打开、路由卸载、草稿离开取消 / 确认均实际验证。
6. 操作级 403 保留有效 HR 会话；身份暂不可用保留草稿并禁止写入；账号切换、撤权及 HTTP 401 不能恢复旧编辑器。
7. 晋级历史直接来自 advancement/history，按服务端顺序展示真实 HR、时间、来源 / 目标 / 类型 / 原因及当时缺评快照。通过真实 API 补录后，原晋级历史逐字段保持不变。
8. 所有浏览器场景均为零 V2 API 请求。

## 截图索引

- [正常晋级确认](advance-normal-confirm.png)
- [全部缺评 ID、真实不推荐意见与理由](advance-missing-reason.png)
- [跳过评估确认](advance-skip-confirm.png)
- [Scheduled 硬阻断](advance-scheduled-block.png)
- [真实晋级历史与不可改写缺评](advance-real-history.png)
- [409 理由草稿与禁止连跳](advance-409.png)
- [未决写入](advance-uncertain.png)
- [Loading](advance-loading.png)、[无真实历史](advance-empty.png)、[Error/Retry](advance-error.png)
- [390px 移动页面](advance-mobile.png)

## 夹具边界、风险与验收交接

- 预约、完成、面评、晋级、缺评豁免、补录、关闭均通过现有真实 V3 HTTP API 生成虚构事实，没有在产品中伪造事件。
- 409 测试包装器在浏览器新预检之后、其命令进入服务前调用另一条真实晋级 HTTP 命令，确定性制造竞争。
- 401 在测试 HTTP 边界注入；JWT 真实签名 / 过期 / V2 隔离仍由既有 API 回归验证。角色撤销仅改变隔离虚构用户。
- socket hang up 是故意丢失成功响应，不是未报告失败。
- 晋级事务 / 豁免 / 回执 / 事件故障回滚由本次 pnpm test 实际运行的 tests/v3-decision-http.test.js 故障注入覆盖；前端场景不替代 AC-15 的正式 DB 验收。
- 390px 是 Chromium 视口验证，尚非真实手机 / 触屏 / 屏幕阅读器验收；长详情保留已批准纵向布局，面评读取扇出等既有 P2 未借本批调整。
- 本批相关 AC-04/05/06/07/08/14/20/25/35 隔离路径有证据，不标记全量正式 AC 通过；Offer 生命周期与普通申请关闭 UI 仍未实施。
- 当前交接：等待 A 源码审查及 03 设计复核。不得自行 Merge、部署或开始后续批次。
