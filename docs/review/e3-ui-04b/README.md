# E3-UI-04B Offer 生命周期与招聘结案

授权 DEC-E3-UI-04B-START-01。仅审查分支开发 / 隔离验证 / Draft PR；等待总控 A 源码验收及 03 设计复核，不自行 Merge。

## 基线、源码与实现

- Base ca62e92e31773269cdae0a86daa07f9023aa60b3；review/e3-ui-04b → feature/hireflow-v3。
- 保护 main：490b9ee2f1985b37052feebefd73605aa0dba1ab。
- src/api/offer-v3.ts：真实 DTO、服务端单动作资格映射、原操作前提比较、中文状态及专用路径。
- src/api/offer-read.ts：显式读取申请、Offer、Offer/Closure 预检；不同版本的 GET 结果拒绝混用。
- src/components/V3OfferPanel.vue：Offer 与普通结案分区、预约阻断、真实历史、共享编辑租约；异步打开前占用，返回后验证路由 / 会话 / 生命周期 / 租约，关闭后等待卸载再释放自身租约。
- src/components/V3OfferEditor.vue：专用命令、明确确认、无默认结案结果、理由校验、提交前新预检、409 原动作保护、原 Key 未决重放、局部 writing 同步离开保护。
- src/components/V3OfferState.vue：阶段 / 生命周期 / Offer / outcome 分开，服务端结束原因、时间及完整历史前后状态。
- src/styles/v3-offer.scss：卡片、状态、原因表单、双栏只读快照；390px 单列。
- src/views/V3Recruiting.vue：最小接入；关闭后的 accepted 显示为“已接受（Offer 最后事实）”，不再错误提示待确认录用。
- tests/v3-offer-ui.test.js、tests/browser/v3-offer.mjs：纯策略边界及真实 HTTP/Chromium 验证。

Figma 08/09 均通过 MCP 实际读取并核对；复用现有 Shell、详情骨架及已验收卡片语言，不重构整个三栏详情。未修改后端 API / Schema / 状态机 / 公共导航 / 冻结文档，无真实邮件、短信或第三方通知。

## 实际质量门禁

| 命令                                                 | 结果                                                    |
| ---------------------------------------------------- | ------------------------------------------------------- |
| pnpm test                                            | 179 通过，0 失败，0 跳过；含 3 个新增前端策略测试       |
| pnpm exec vue-tsc --noEmit                           | 通过                                                    |
| pnpm lint                                            | 通过；0 错误，1 个既有 dashboard/index.vue 属性顺序警告 |
| pnpm build                                           | 通过，未部署                                            |
| 变更文件 Prettier / git diff --check                 | 通过                                                    |
| node tests/browser/v3-offer.mjs <仓库外输出目录>     | 8 组主流程通过                                          |
| node tests/browser/v3-advancement.mjs <外部输出目录> | UI-04A 10 组回归通过                                    |
| node tests/browser/v3-feedback.mjs <外部输出目录>    | UI-03B 9 组回归通过                                     |
| node tests/browser/v3-interviews.mjs <外部输出目录>  | UI-03A 完整回归通过                                     |
| node tests/browser/v3-recruiting.mjs <外部输出目录>  | UI-02 完整回归通过                                      |

环境：Windows Chromium、Node v24.17.0、fresh V3 内存 SQLite、虚构 HR、随机密码 / JWT、loopback Express / Vite。浏览器脚本串行运行，自动关闭其服务和浏览器；无生产库或真实招聘资料。

开发中发现并修复的验证问题：测试辅助变量 command/pending 与旧夹具重名；一处 v-if/v-for Lint 错误；关闭后 send/accept 测试不应携带不支持的 reason 字段。最终无未解决测试失败。socket hang up 来自有意丢失成功响应。远程预检曾有一次 Empty reply from server，后续独立查询恢复并核验批准 SHA。

## 实际业务矩阵与证据

- preparing → send → sent；sent → accept → accepted 仍 active/outcome=null；accepted → confirm-hire 才 closed/hired，Offer 保留 accepted。
- 空录用理由不发送 reason 字段，由服务器生成“HR 确认录用”，事件 reasonSource=system_default；不是伪造 HR 输入。
- sent → decline 非空原因，专用单命令原子产生 declined/closed/offer_declined；断言无额外 /close 请求。
- preparing 直接 accept/decline/hire、sent 直接 hire、非 Offer send、通用 close 的 hired/offer_declined、关闭后全部常规动作实际被拒。
- UI 四阶段分别执行 company_rejected / candidate_withdrew（8 种）；Offer sent/accepted 额外执行 candidate_withdrew，保持最后 Offer 事实。sent/accepted 的 company_rejected 与更多非法组合由既有 tests/v3-decision-http.test.js 回归覆盖，未冒充新增 UI 场景。
- 预约阻断 close/decline/hire；send/accept 仍遵从各自服务端 allowed，不自创全局预约禁令。
- 409 保留原动作 / 理由，服务器已完成 send 后不改成 accept；未知 accept 重试 Key / 内容 / 路径相同，仅 1 个事件 / 回执。
- 空理由 send 写入响应被确定性延迟时，路由离开提示、取消保留、成功清理脏状态均实际验证；空理由 confirm-hire 响应延迟也验证保护已同步开启。
- 五编辑器双向异步互斥、草稿离开确认、延迟打开后卸载、操作级 403、身份失联、撤权、HTTP 401、账号切换均通过；全部零 V2 API 请求。
- 历史来自 offer/history，保持服务端顺序、真实 HR / 时间 / 原因来源及完整前后状态，不从当前状态推算历史。
- 关闭后已有评价更正 / 不得新增缺评由 UI-03B 本次完整 Chromium 回归及既有后端测试覆盖。

## 截图与执行记录

本目录 PNG 均来自最终代码实际 Chromium，虚构数据，不含凭据：
preparing、sent、accepted-not-hired、hire-confirm、hired-history、declined、closure-first-interview、scheduled-block、409、uncertain、pending-leave、loading、empty、error、mobile。
results.json 为 UI-04B；regression-ui04a/03b/03a/02-results.json 为本轮实际回归记录。

## 夹具边界与剩余风险

- 常规阶段流转、Offer、结案、面试与面评由真实 API 形成。
- 为单独检验 send/accept 与结束动作的预约规则差异，测试中显式准备了 scheduled + Offer 的极端隔离状态；正常合法晋级不会产生它。这是夹具准备，不是产品允许绕过晋级。
- 并发由测试包装器在浏览器新预检后执行另一个真实命令制造；401 在 HTTP 边界注入，真实 JWT 验证由既有 API 测试覆盖。
- 事务及回执 / 事件故障回滚复用本次 pnpm test 实际运行的后端故障注入，不把 UI 验证写成正式 AC 数据库验收。
- 390px 为 Chromium 视口，不是实机、触屏、屏幕阅读器或生产验收；保留既有长详情布局，P2 未扩展。
- 相关 AC-10/11/12/13/20/26/27/33 有本批隔离证据，不标记 AC-01～36 正式全量通过。
- 下一步仅交总控 A 与对话 03 审查；禁止自行 Merge、部署、真实迁移或启动下一批。
