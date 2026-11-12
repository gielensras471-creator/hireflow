# R04-C 本地定点验证
基线：4abac4c1941b6f7089bf217c8ebbb8001711529a；分支 review/e3-ui-refine-04。本目录位于仓库外，未归档到 GitHub。
## 修改
- src/components/V3Feedback.vue：增加 data-state 样式标记；原 aria-busy、status/alert、action emit 不变。
- src/styles/v3.scss：空态虚线边界、错误起始侧边线、复用 border Token 的通用骨架、标题行高与安全换行；不新增动效。
- tests/browser/v3-dashboard.mjs：R04_C 定点模式、分区域 Loading/Error/Retry、空态语义、分页禁用、真实键盘 Enter 重试和可见焦点、网络零业务写入断言。原断言保留。
完整差异见本提交的 Git Diff。
## 无需修改
已有主次按钮、禁用状态、全局 focus-visible、重试动作和状态 ARIA 已具备基础实现。未改 Dashboard 业务组件、局部 CSS、权限、路由或编辑器。未修改 Offer 延期样式。
## 实际验证
真实 Express + 全新内存 SQLite + 虚构 HR + Chrome/157.0.8103.78。结果见 results.json、quality.json。
验证三个区域独立加载、独立失败与重试；局部失败保留其他区域数据；错误指标不显示虚假 0；503 恢复；操作级 403 保留会话、真实撤权后退出；分页、旧响应丢弃、局部横滚、账户切换、零 V2 请求与零 Dashboard 业务写入。
归档代表截图：r04c-retry-focus（1440）和 r04c-today-error（390）；其余截图保留在本地证据目录。截图由真实页面原样捕获，针对错误区滚动定位。通用 Loading 骨架样式已构建验证；此 Dashboard 使用独立 Loading，未单独挂载通用 Loading 组件做浏览器视觉断言。
## 范围与风险
未执行六批全量业务 Chromium（本任务要求定点验证）；未执行真机、屏幕阅读器及正式 AC。
R04-UX-RISK-ZOOM-01：原生浏览器 200% 缩放/工具栏及操作可达性仍待最终阶段核查；未修复全局 reset。
Lint 保留 V2 Dashboard 一条既有属性顺序警告；Git 提示 LF 将按既有设置转换 CRLF，diff --check 通过。
无 Commit、Push、PR 状态修改、部署或后续批次。
