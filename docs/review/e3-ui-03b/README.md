# E3-UI-03B 面试评价管理审查证据

授权：DEC-E3-UI-03B-START-01。实现及隔离验证完成，提交审查分支供总控 A 源码验收及对话 03 设计复核；不得视为正式验收或 Merge 授权。

## 基线与复现

- 正式仓库：E:/FIFile/Documents/Codex/hireflow-v3
- 当前审查分支：review/e3-ui-03b
- 本地 HEAD / 批准基线：f4678d06167a5ac1cf5ba831017e3cdcd7c2dc0c
- 创建分支前已 fetch 并独立核验远程 feature/hireflow-v3 为上述基线；main 为 490b9ee2f1985b37052feebefd73605aa0dba1ab。
- 实施期间曾按 Owner 要求暂停；2026-11-10 恢复时重新核验工作区、未提交文件及远程基线，未清理或覆盖已有工作。
- 浏览器复现：在仓库根目录运行下表脚本，输出目录使用仓库外的临时目录；脚本需要已安装 Chrome。测试密码及 JWT 随机生成，不写入证据。

## 已实现

- 申请详情新增面试关联面评区、首次提交、服务端资格预检后的历史补录、有痕更正。
- 专业评价人、实际录入 HR ID、原始提交时间、评价 revision 分开展示。
- 历史展示真实事件、前后完整快照、操作 HR、服务端时间、原晋级豁免关联。
- 通过真实历史 API 的 priorDecisions 判断关闭后决策提示，不从当前阶段推断历史。
- 共用现有编辑租约，在异步打开前互斥；复用现有请求身份、幂等写入及草稿确认。
- 申请 version 与 feedbackRevision 冲突分别刷新事实，保留草稿并要求明确确认。
- 未决创建与未决更正复用原 Key / 原内容；没有修改后端、Schema、业务状态机或 V2。
- Figma 06/07 已通过 Figma MCP 实际读取和截图核对。本轮仅实现详情中的面评区域，保留既有 Shell / 资料骨架，不重构整个 Figma 02。

## 实际验证

| 命令                                            | 实际结果                                                               |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| pnpm test                                       | 173 通过、0 失败、0 跳过；本批新增 4 个面评边界测试及 4 个错误文案用例 |
| pnpm exec vue-tsc --noEmit                      | 通过                                                                   |
| pnpm lint                                       | 0 错误；1 个原有 dashboard/index.vue 属性顺序警告                      |
| pnpm build                                      | 通过；仅本地构建，没有部署                                             |
| 12 个变更源码 / 测试文件 Prettier 检查          | 通过                                                                   |
| git diff --check                                | 通过；Git 提示 LF 后续可能转换 CRLF                                    |
| node tests/browser/v3-feedback.mjs <输出目录>   | 最终完整执行通过 9 组 Chromium 场景，详见 results.json                 |
| node tests/browser/v3-interviews.mjs <输出目录> | UI-03A 完整隔离浏览器回归通过                                          |
| node tests/browser/v3-recruiting.mjs <输出目录> | UI-02 完整隔离浏览器回归通过                                           |

浏览器使用 Windows 本机 Chromium、Node v24.17.0、fresh V3 内存 SQLite、随机测试密码 / JWT、loopback Vite 和真实 V3 Express API。脚本会自动关闭自己创建的服务和浏览器。串行运行三个浏览器脚本，避免多个 Vite 实例争用缓存。未访问真实业务数据库、未操作生产。

首次开发验证曾发现并修正游标类型循环引用及 Vue 模板多语句解析问题；以上表格为修正后的实际通过结果。

## 浏览器场景与夹具边界

results.json 记录 9 组场景：
首次提交前提、三种推荐枚举、评价与 HR 身份分离、提交不晋级、重复拒绝；三种编辑器异步互斥及离开确认；操作级 403 / 身份暂不可用；未知结果相同 Key 重试；更正非空原因 / NO_CHANGE / 原始事实保留；两类真实版本冲突、最新快照和明确确认；历史豁免补录 / 关闭后拒绝新增；关闭后更正和决策证据；Loading / Empty / Error / Retry、390px、切换账号 / 撤权及零 V2 请求。

- 晋级、缺评豁免、申请关闭由已有合法 V3 HTTP API 形成，未伪造事件。
- 无豁免的极端场景明确由夹具直接改变一条虚构申请阶段，以验证不一致数据不会获得补录资格；这不是产品合法晋级流程。
- feedbackRevision 冲突在真实并发更正后，测试包装器仅对齐 expectedVersion，从而独立验证服务端 revision 冲突；并未改动产品 API。
- socket hang up 日志由故意丢失成功响应的测试产生。已同时验证创建及更正重试只产生一次效果。
- 这不是正式 AC-01～AC-36 全量验收，未覆盖真实设备、生产数据或后续晋级 / Offer / Dashboard UI。

## 截图

所有图片均来自最终修订代码的实际 Chromium 页面，虚构数据，不含密码或 JWT。

- feedback-submit.png：首次面评表单
- feedback-current.png：当前有效面评
- feedback-correction.png：原内容与更正表单
- feedback-history.png：真实历史及前后快照
- feedback-historical-missing.png：真实缺评豁免与补录入口
- feedback-supplemented.png：晋级后补录事实
- feedback-closed-correction.png：关闭后更正及真实决策关联
- feedback-409.png / feedback-revision-conflict.png：两类冲突保留草稿
- feedback-uncertain.png：未决写入
- feedback-loading.png / feedback-empty.png / feedback-error.png：读取状态
- feedback-mobile.png：390px 页面

UI-03A / UI-02 回归结果分别保存在 regression-ui03a-results.json、regression-ui02-results.json。脚本在 tests/browser/v3-feedback.mjs。

## 审查边界与后续

1. 本批只接入现有面评 HTTP 契约，没有修改后端业务 API、Schema、Command Core、生产入口或冻结文档。
2. 14 张截图及 3 份结果记录随审查分支提供，使用 PR 的固定 Commit 链接进行独立核对。
3. 申请详情继续复用已有纵向资料骨架，面评表单采用 06/07 的卡片、文字层级和左右快照结构；390px 转为单列。未将整个申请详情重做为最终画板。
4. 当前读取每场面试资格需要单独请求；大量面试时存在请求扇出与长页面成本，后续可另批优化，未扩展后端契约。
5. 首次提交、历史补录、更正与关闭后更正的本批相关隔离链路已验证；正式 AC-05/20/23/24/34/35 的跨模块验收仍待总控组织，尤其 Dashboard 口径和真实设备。
6. Draft PR 等待 A 源码审查及 03 设计复核；不得自行 Merge、修改 feature/main 或开始下一批。
