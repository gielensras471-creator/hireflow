# R03-E-P2-01 定点补正

授权 DEC-E3-UI-REFINE-03-R03E-CODE-REVIEW-01；起始 HEAD 56a12ac91fa7dd2473ebfe3d707e500ff1fa3f8b，原 PR #9 保持 Draft。

## 修复

- `src/components/V3FeedbackPanel.vue`：晋级后补录事实的 supplementedAt 与原晋级豁免事实的 occurredAt 均调用既有 `safeHistoryTime(value, feedbackTime)`。
- 正常值继续通过原 Asia/Shanghai 格式器显示实际年月日和秒；null、undefined、NaN、非法及数字字符串、超范围均显示“发生时间未记录，待核实”。没有改变事件 ID、关联、原因、显示条件或服务器数据。
- `tests/v3-readonly-fallback.test.js`：对 Vue 编译的真实 V3FeedbackPanel 模板进行 SSR 渲染；隔离投影分别验证两处正常/异常时间、事件 #73 与原豁免 #42、原因及无伪造日期。模板含 TS 非空断言，测试编译器先剥离类型语法；旧测试未删除。
- 原真实豁免→后补录关联、403、409、原 Key 重放、历史完整性由本轮真实 Chromium Feedback 回归执行；并非把虚构 DTO 投影当作服务端真实事实。

## 本轮执行

- `pnpm test`：196 通过、0 失败、0 跳过。
- `pnpm exec vue-tsc --noEmit`、`pnpm build`：通过。
- `pnpm lint`：0 错误；1 条既有 V2 dashboard/index.vue 属性顺序警告。
- 变更文件 Prettier、Git diff 和暂存检查：提交前执行。
- 六批独立 Chromium：Feedback、Recruiting、Interviews、Advancement、Offer、Dashboard。每批使用新内存 V3 SQLite、虚构用户与本目录新结果；Feedback 启用 R03_A/B/C/D/E 全部专项。各目录 results.json 与实际截图为本轮重新生成。受控断网输出 socket hang up 为预期测试注入。
- A～E 原始审查证据未覆盖；本目录为独立 patch-01。

## 边界

异常时间使用真实模板的隔离 SSR 数据，不宣称对每种异常 DTO 都已在 Chromium 网络层注入。没有真实设备、读屏、生产数据或正式 E4/AC 全量验收。六批通过不等于 Owner 或总控最终签字。没有进行 Merge、部署或 REFINE-04。
