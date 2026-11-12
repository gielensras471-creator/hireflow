# R03-A 申请详情编辑器生命周期安全基底

授权：DEC-E3-UI-REFINE-03-DESIGN-APPROVED-01；仅R03-A。Base e087241f2bc442364fb4ee71bf7432ede94f14f4，review/e3-ui-refine-03 → feature/hireflow-v3。

## 设计资料边界

已读取AGENTS、当前源码及本轮任务书。仓库未找到《HireFlow REFINE-03 申请详情信息架构设计补充方案 v1.0》完整文件；本轮按任务书明确列出的稳定实例、刷新、身份、租约和幂等边界执行。不能声称已逐条读取完整L01–L10原文。未开展布局/锚点/折叠/摘要；后续B–E需独立授权及完整设计依据。

## 已确认路径与可达性

基线V3Recruiting.load()在读取开始清空selected，四面板v-if依赖selected、loading、error，故刷新时卸载。生产UI当前父级刷新主要来自子模块保存后的updated，以及路由变化；业务编辑通常持有共享Gate，子面板自身刷新入口受到Gate保护。不能据静态路径声称用户已经丢失数据。

红/绿专项以测试浏览器中的真实Vue实例调用既有父级load回调，覆盖未来/边界刷新；该入口是受控集成测试，不伪装成基线存在一个用户可点的父级刷新按钮。另用真实HTTP面评保存的updated事件验证实际用户可达路径。

## 红/绿与实例证据

- red/r03-lifecycle.json及expected-failure.txt：修复前四个UID全部改变，捕获四次unmount；命令以R03_A=1运行反馈Chromium，预期失败。证据在改产品源码之前生成。
- feedback/r03-lifecycle.json：最终源码同一申请刷新前后四UID一致，无刷新引发的unmount。
- feedback/r03-real-save.json：真实面评保存/幂等重放完成后的父级updated路径，四UID仍一致；编辑器正常关闭。
- feedback/r03-write-evidence.json：丢失成功响应后原Key及正文一致，单份评价、事件和回执，不创建下一独立请求。

## 最小实现

1. 父级同申请刷新保留selected和四业务面板，读取状态独立；loading/error/refreshPending通过disabled传给三个Panel及面试区域，旧数据带清楚提示，不能作为新的可写资格。
2. 有编辑或异步打开租约时，将父级刷新合并为refreshPending，保留编辑器实例/草稿/原请求。Gate释放且身份ready后自动执行。身份暂不可用时不吞掉排队刷新，恢复ready后继续。
3. 父级成功读取递增detailRevision；子面板观察refreshToken重新核实自身业务上下文及相应历史。保留原预检、旧响应丢弃和服务端规则。刷新失败不会重建子树，新的操作被阻止，显式重试成功后恢复。
4. 路由或真实用户ID变化清空旧详情、作废旧读取及打开操作；回调再次核对alive、path和会话世代。同账号auth/me返回新user对象不会因为对象身份变化重置草稿。
5. 未修改任何Editor、共享Gate、createWriteIntent、路由离开保护、请求认证、后端/API/Schema或业务规则。

## 场景与硬门禁

| 门禁              | 本轮隔离验证                                                                                          | 证据                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| L03 稳定实例/草稿 | 同ID成功刷新四面板UID一致；面评草稿/编辑器UID保留；真实保存后编辑器正常关闭                           | r03-lifecycle、r03-real-save、r03-deferred-draft.png                              |
| L04 未决/原Key    | 成功响应丢失后登记父级刷新，原编辑器和Key/正文不变；重试仅一次业务事实                                | r03-write-evidence.json、r03-uncertain-refresh-keeps-intent.png及现有HTTP计数断言 |
| L05 409人工确认   | 保留实际版本/修订冲突、读取、取消和确认流程                                                           | feedback/feedback-409、revision-conflict及advancement/offer真实场景               |
| L06 403边界       | 操作级拒绝保留会话和草稿；真正角色撤销退出且不写入                                                    | 反馈完整Chromium既有断言                                                          |
| L07 单一Gate      | 异步打开互斥、面评编辑时其他入口禁用；排队刷新不释放原租约                                            | 反馈/面试双方向租约场景                                                           |
| L08 父级刷新      | 无编辑稳定实例；有编辑延后；释放后成功/失败可见；失败阻止新操作，重试恢复；身份恢复可继续排队刷新     | r03-refreshed、refresh-failed-blocked、identity-recovery-resumes-refresh          |
| L09 隔离          | 旧父请求延迟，SPA切换申请后释放不污染；旧账号父请求延迟，换账号读取后释放不污染；旧表单不可跨账号写入 | r03-late-parent-response-isolated、r03-cross-account-old-response及撤权断言       |

L03～L09仅表示本轮具体隔离场景证据，等待总控验收，不等于全部生产情形已证明。L01/L02/L10的锚点与折叠不在本轮，不声明最终通过。

## 实际命令与质量门禁

- pnpm test：190通过/0失败/0跳过，原Node回归保留。
- pnpm exec vue-tsc --noEmit、pnpm build通过。
- pnpm lint：0错误，1个既有V2 Dashboard属性顺序警告。
- 变更文件Prettier、git diff --check见最终交付。
- 六批脚本均本轮执行：Recruiting、Interviews、Feedback、Advancement、Offer、Dashboard；各子目录results.json为本轮生成。
- 专项命令：PowerShell设置 $env:R03_A='1'，运行 node tests/browser/v3-feedback.mjs docs/review/e3-ui-refine-03/r03-a/feedback，结束删除该临时环境变量。普通反馈测试未设置时只运行原场景。
- 测试包装器只对隔离GET注入延迟/503；真实Express V3、fresh内存SQLite、虚构HR、真实HTTP业务命令和Chromium。

## 开发期失败记录

红测试为预期失败。中间曾在浏览器回归运行时修改源文件触发HMR，该轮晋级重试结果不作为最终通过证据，之后固定源码重跑。新增账号切换夹具最初恢复了12小时会话，与原模拟时间推进一天冲突；恢复原测试的记住登录设置，未改产品Token规则。面试原测试在保存后立即读取按钮，新增等待刷新上下文就绪，原业务禁用断言保留。预期丢失响应测试的socket hang up不是隐瞒的回归失败。

## 文件与剩余边界

改动：src/views/V3Recruiting.vue、V3Interviews.vue；src/components/V3FeedbackPanel.vue、V3AdvancementPanel.vue、V3OfferPanel.vue；tests/browser/v3-feedback.mjs、v3-interviews.mjs；本目录证据。

没有新增业务功能或刷新按钮，没有详情布局改造。草稿专项重点使用面评编辑器，所有五类编辑器并未逐一重复同一回调注入组合；其他模块通过既有完整Chromium回归保护。真实手机、屏幕阅读器、生产数据/迁移和正式AC验收未执行。后续布局必须保留当前稳定key、单一Gate、延后刷新和资格核实，不得借折叠卸载活动编辑器。

完成后保持Draft，等待A安全验收；不得Merge、部署或自动开始R03-B～E。
