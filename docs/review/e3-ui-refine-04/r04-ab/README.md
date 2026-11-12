# R04-A+B 本地审查证据
任务 TASK-E3-UI-REFINE-04-R04-AB-01；基线77e02f3fac4fc7dbc6097e2d89be21792fbeabcd；本地分支review/e3-ui-refine-04。
Fetch使用经验证的临时HTTP代理，不改全局设置。旧分支review/e3-ui-04b仍为afc7016c6a5542718edf4d104b8ae07c89b19a85。
源码只改 src/styles/v3-dashboard.scss、src/views/V3Dashboard.vue、tests/browser/v3-dashboard.mjs。完整差异见 R04-AB.diff；没有Add/Commit/Push/PR/Merge。

R04-A：四列桌面；390优先2x2，320安全单列。共同指标容器覆盖正常与Loading。真实标题、数字、单位、完整统计口径和读取时间不变；长文字/数字换行保留全文。
R04-B：未选中不再有“选择此类”；唯一选中保留✓文字+内侧边框；键盘焦点独立外轮廓。button及aria-pressed与原select/API流程保留。

实际测试：
- pnpm test 196通过/0失败/0跳过；
- vue-tsc --noEmit、build、Prettier、git diff --check通过；
- lint 0错误/1条既有V2 dashboard/index.vue属性顺序警告；
- R04_AB=1 node tests/browser/v3-dashboard.mjs <本证据目录>：真实V3 Express、全新内存SQLite、虚构HR、Chrome，完整原Dashboard回归及新增断言通过。包含真实指标、六类鼠标/Enter/Space、唯一ARIA、选中和焦点同时可辨、标题/下拉/请求/明细联动、分页/迟到读丢弃、局部表格滚动及键盘、Loading/Empty/Error/Retry、身份与无额外写入/零V2请求。

关键量测见r04-measurements.json：1440/1100四列；390×844/900两列、单卡167×138.58px、网格293.16px、工作入口顶部654.06px、整页宽382px；320一列、无新增整页横滚。390的Loading也断言两列。
长标题/大数字使用明确的临时合成DOM布局压力数据，只检查完整文字不横溢，随即恢复真实数据，没有变更API统计或将合成值作为真实业务截图。

缩放边界：本轮使用Chromium CSS zoom 200%进行重排压力测试，不冒称浏览器工具栏原生200%或真机。指标已退回一列；全局 src/styles/reset.scss 的body min-width:320px在该模式下变成640px可视宽度，390px视口存在整页横滚。未修改全局Shell/reset。该问题需总控决定后续范围，不能宣称所有缩放场景通过。

八张关键PNG及少量JSON保留于仓库外；未复制历史证据。没有改后端、Schema、状态机、冻结设计、全局Shell/Router/编辑器或动效。初轮CSS替换未匹配CRLF导致移动列数断言失败，已修正；缩放异常如上保留记录。最终真实断点和业务回归断言通过。

完成后停止，等待总控A源码验收，不自动开始R04-C或E4。
