# E3-UI-REFINE-02 审查

授权 DEC-E3-UI-REFINE-02-START-01。Base：79d8de24927a797e7ea223aa6229e6246660f450。review/e3-ui-refine-02 → feature/hireflow-v3。独立工作树 hireflow-v3-refine-02；原工作区、预览、旧PR分支未覆盖。

## 实施范围与取舍

- REFINE-005：六待办共用“✓ 已选中”文字、outline与aria-pressed；未选中保留相同占位高度，切换不改变卡片布局。真实计数、类别及API不变。
- 表格增加V3TableScroll小型展示容器，供职位/申请、面试、Dashboard正常及骨架表格复用。只管理DOM测量和原生滚动，不持有业务状态或发请求。ResizeObserver监控容器/表格尺寸，组件更新后核对表格；卸载disconnect，Vue自身管理局部scroll/keydown事件。没有全局滚动监听或第三方依赖。
- 实际溢出才显示方向提示；右边缘仅提示向左；不重设用户滚动位置。溢出区tabindex=0、有名称/说明/焦点；方向键仅在容器自身聚焦且无修饰键时滚动，内部链接与按钮不受拦截。
- 正常与Loading表格有名称和列头scope；列结构、原测试钩子、行顺序保留。
- REFINE-006：面试精确ID筛选增加可见标签、用途、占位和已应用路由条件；筛选/清除和参数不改。Dashboard申请编号加粗，职位/面试编号次级，链接仍跳/candidates/:id；无姓名补造或额外详情请求。
- R01-UX-P2-01：申请列表按独立字段显示尚未结束、未进入Offer、真实Offer子状态或已接受历史事实；关闭旧档缺失保留未记录，未知非空值待核实。
- R01-UX-P2-02：label只接受自有属性，toString/constructor/**proto**均安全回退；空值行为不变。

## 文件范围

src/api/recruiting-v3.ts；src/components/V3TableScroll.vue（新增）、V3DashboardTable.vue；src/views/V3Recruiting.vue、V3Interviews.vue、V3Dashboard.vue；src/styles/v3-interviews.scss、v3-dashboard.scss；tests/v3-refine-copy.test.js；三批browser脚本及新增refine-list-checks.mjs。

未修改后端、Schema、冻结文档、认证、草稿/编辑器/幂等、路由守卫、Shell、V2或已批准业务规则。

## 质量门禁与真实证据

- pnpm test：190通过/0失败/0跳过。
- pnpm exec vue-tsc --noEmit、pnpm build通过。
- pnpm lint：0错误，1个既有V2 Dashboard属性顺序警告。
- 变更文件Prettier、git diff --check：见最终交付。
- 六批真实V3 Express/内存SQLite/虚构HR/Chromium串行回归，结果分别保存于recruiting、interviews、feedback、advancement、offer、dashboard子目录；均本轮实跑，不复制旧JSON。
- Dashboard六类Enter/Space与真实CDP鼠标点击，显式选中与aria-pressed同步；旧响应丢弃、只读刷新及详情跳转继续验证。
- 三类列表分别实测1440/1100/390、无溢出/有溢出、Tab/方向键、右边缘提示、恢复宽屏。原始clientWidth/scrollWidth/pageWidth及提示在各scroll-keyboard.json。
- 浏览器注入仅用于测试的ResizeObserver探针，确认目标滚动区受监控；隐藏/恢复组件不增加实例，路由离开后观察器数为0。测试隐藏是DOM区域隐藏，不冒称操作系统后台页签生命周期验收。
- 原403操作级权限、409草稿与人工确认、未决同Key重放、双版本/租约、面评更正、Offer accepted与hired分离、上海边界、零V2请求断言保留。
- 故意丢失响应场景的socket hang up属于测试注入。开发期修正测试视口尺寸测量（innerWidth与滚动条占宽不同）、尺寸稳定后右端判断和CDP Enter字符事件；未通过改动业务断言掩盖问题。

## 截图索引

- dashboard/selected-primary.png、selected-secondary.png：四主两次选中反馈。
- dashboard/dashboard-table-{1440,1100,390}.png、dashboard-table-keyboard.png、dashboard-table-right-edge.png：待办ID、视口和横滑。
- recruiting/applications.png：独立状态与合法空值；positions.png、applications-filtered-empty.png、applications-page-2.png、applications-loading.png、applications-error.png：真实列表/筛选/分页/Loading/Empty/Error。
- recruiting/recruiting-table-{1440,1100,390}.png、recruiting-table-keyboard.png、recruiting-table-right-edge.png：申请桌面和手机横滑前后。
- interviews/interviews-table-{1440,1100,390}.png、interviews-table-keyboard.png、interviews-table-right-edge.png：面试筛选和横滑；interviews-loading.png等保留真实场景证据。
- 六子目录results.json：实际业务回归结果；三类列表scroll-keyboard.json：专项原始测量。

## 限制与保留事项

没有名称API时继续显示稳定编号；不增加姓名模糊查询、不全表前端过滤。未实施固定操作列、卡片化、详情重排、历史折叠、手机指标重构或动效。正常空值及原型键为执行实际展示函数的Node测试，合法active申请另有真实页面断言；未构造正式后端允许非法旧值的入口。真实手机/触控、屏幕阅读器、OS页签隐藏及完整AC验收未执行。设计复核尚待03，不能据本PR自行宣布全局收口或AC通过。

完成后保持Draft，等待A源码、03设计、Owner独立合并授权；禁止自行Merge或启动REFINE-03。
