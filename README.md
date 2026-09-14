# HireFlow 招聘流程协作平台

HireFlow 是一个基于 **Vue 3 + TypeScript + Pinia + Element Plus** 开发的招聘流程协作平台。

项目围绕企业招聘过程中的职位管理、候选人跟进、面试安排和招聘数据统计展开，通过 Mock REST API 模拟真实前后端交互流程，实现了从职位创建、候选人录入到面试推进和 Offer 阶段的完整招聘业务闭环。

> 当前项目主要用于前端工程实践与作品展示。  
> 数据接口由 `json-server` 提供 Mock REST API，并非真实生产后端。

---

## 在线演示

**在线地址：**  
https://hireflow-wed.onrender.com

**GitHub：**  
https://github.com/gielensras471-creator/hireflow

**演示账号：**

```text
账号：admin
密码：123456
```

> 在线演示使用 Render 部署的 Mock REST API。  
> Render 免费实例长时间无访问后可能进入休眠，首次打开页面或首次加载数据时可能需要等待几十秒。  
> 演示数据可能在服务重启或重新部署后恢复为初始数据。

---

## 项目截图

### 登录页

HireFlow 登录页采用左右分栏布局，突出产品品牌与招聘业务场景，并提供 Demo 账号快速体验。

![HireFlow 登录页](./docs/images/login.png)

### 招聘工作台

工作台集中展示招聘中职位、候选人、今日面试、待处理事项，以及近 7 日候选人趋势和招聘阶段分布等核心数据。

![HireFlow 招聘工作台](./docs/images/dashboard.png)

### 候选人管理

支持候选人的新增、编辑、删除、筛选、分页、查看详情和安排面试，并根据招聘阶段展示不同业务状态。

![HireFlow 候选人管理](./docs/images/candidates.png)

### 候选人详情

候选人详情页展示基础信息、应聘岗位和招聘进度。多个候选人详情同时打开时，顶部 Tabs 会根据候选人姓名动态区分标签，方便并行处理候选人。

![HireFlow 候选人详情](./docs/images/candidate-detail.png)

---

## 项目预览

### 核心模块

- 招聘数据工作台 Dashboard
- 职位管理
- 候选人管理
- 候选人详情
- 面试管理
- 招聘阶段流转
- 个人信息管理
- 登录与基础路由鉴权
- 响应式页面适配
- Loading / Empty / Error 状态处理

---

## 技术栈

| 技术 | 用途 |
| --- | --- |
| Vue 3 | 前端核心框架 |
| TypeScript | 类型约束与开发体验 |
| Vite | 项目构建工具 |
| Vue Router | 页面路由管理 |
| Pinia | 全局状态管理 |
| Axios | HTTP 请求封装 |
| Element Plus | UI 组件库 |
| ECharts | 招聘数据图表 |
| Sass | 页面样式 |
| json-server | Mock REST API |
| ESLint + Prettier | 代码规范 |
| pnpm | 包管理 |

---

## 功能介绍

### 1. 招聘工作台

Dashboard 根据职位、候选人和面试数据动态计算招聘统计信息，包括：

- 招聘中职位数量
- 候选人总数
- 今日面试数量
- 待处理候选人数量
- 近 7 日候选人趋势
- 候选人招聘阶段分布
- 今日面试安排

图表数据来源于当前 Mock API 数据，而不是静态写死的展示数据。

---

### 2. 职位管理

支持招聘职位的完整 CRUD 操作：

- 新增职位
- 编辑职位
- 删除职位
- 开启 / 关闭招聘
- 关键词搜索
- 部门筛选
- 状态筛选
- 分页展示

所有数据修改均通过 REST API 完成，并在接口请求成功后更新页面状态。

---

### 3. 候选人管理

支持候选人的完整招聘管理流程：

- 新增候选人
- 编辑候选人
- 删除候选人
- 查看候选人详情
- 按姓名 / 职位 / 阶段筛选
- 安排面试
- 推进招聘阶段
- 淘汰候选人

候选人详情页支持独立路由访问和浏览器刷新。

多个候选人详情同时打开时，顶部 Tabs 会根据候选人姓名动态显示，例如：

```text
陈晓 · 详情
林悦 · 详情
```

方便同时处理多个候选人。

---

### 4. 面试管理

支持完整的面试流程管理：

- 安排面试
- 编辑面试信息
- 完成面试
- 取消面试
- 删除面试记录
- 按状态筛选面试
- 与候选人招聘阶段联动

面试状态包括：

```text
scheduled   已安排
completed   已完成
cancelled   已取消
```

---

## 招聘阶段流转

HireFlow 将招聘阶段规则集中维护，避免多个页面分别编写重复的业务判断。

当前候选人阶段：

```text
筛选
 ↓
初面
 ↓
复面
 ↓
Offer
```

同时支持：

```text
任意有效阶段 → 淘汰
```

内部状态：

```text
screening
first_interview
second_interview
offer
rejected
```

例如：

- 筛选阶段安排初面后 → 自动进入「初面」
- 完成初面 → 进入「复面」
- 完成复面 → 进入「Offer」
- Offer 和已淘汰候选人为终止状态
- 终止状态无法继续安排面试或推进流程

相关规则统一维护在：

```text
src/config/recruitment.ts
```

---

## API 设计

项目使用 `json-server` 模拟 REST API。

主要资源：

```text
/positions
/candidates
/interviews
```

支持：

```text
GET
POST
PATCH
DELETE
```

例如：

```http
GET /candidates
GET /candidates/1

POST /candidates

PATCH /candidates/1

DELETE /candidates/1
```

请求统一通过 Axios 封装：

```text
src/api/request.ts
```

业务 API 按模块拆分：

```text
src/api/modules/
├─ candidate.ts
├─ dashboard.ts
├─ interview.ts
└─ position.ts
```

---

## 项目结构

```text
hireflow/
├─ docs/
│  └─ images/
│     ├─ login.png
│     ├─ dashboard.png
│     ├─ candidates.png
│     └─ candidate-detail.png
│
├─ mock/
│  └─ db.json
│
├─ public/
│  └─ favicon.svg
│
├─ src/
│  ├─ api/
│  │  ├─ modules/
│  │  │  ├─ candidate.ts
│  │  │  ├─ dashboard.ts
│  │  │  ├─ interview.ts
│  │  │  └─ position.ts
│  │  └─ request.ts
│  │
│  ├─ assets/
│  ├─ components/
│  ├─ config/
│  │  └─ recruitment.ts
│  ├─ layout/
│  ├─ router/
│  │  └─ index.ts
│  ├─ store/
│  │  └─ modules/
│  ├─ styles/
│  ├─ types/
│  ├─ views/
│  │  ├─ candidates/
│  │  ├─ dashboard/
│  │  ├─ interviews/
│  │  ├─ login/
│  │  ├─ positions/
│  │  └─ profile/
│  ├─ App.vue
│  └─ main.ts
│
├─ .env.development
├─ .env.production
├─ index.html
├─ package.json
├─ pnpm-lock.yaml
├─ tsconfig.json
└─ vite.config.ts
```

---

## 本地运行

### 1. 克隆项目

```bash
git clone https://github.com/gielensras471-creator/hireflow.git
```

进入项目：

```bash
cd hireflow
```

### 2. 安装依赖

```bash
pnpm install
```

### 3. 启动 Mock API

打开一个终端：

```bash
pnpm mock
```

Mock API 默认运行在：

```text
http://localhost:3300
```

数据存储在：

```text
mock/db.json
```

### 4. 启动前端

再打开一个终端：

```bash
pnpm dev
```

根据终端输出访问对应的本地地址即可。

---

## 演示账号

```text
账号：admin
密码：123456
```

项目当前采用本地 Demo 登录方式。

登录成功后会保存基础登录状态，并通过 Vue Router 路由守卫控制未登录用户访问业务页面。

---

## 常用命令

```bash
# 启动开发环境
pnpm dev

# 启动 Mock API
pnpm mock

# TypeScript 检查并生产构建
pnpm build

# ESLint 检查
pnpm lint

# ESLint 自动修复
pnpm lint:fix

# 本地预览生产构建
pnpm preview
```

---

## 项目设计特点

### API 与页面状态分离

业务页面不直接操作 Mock 数据，而是统一经过：

```text
页面
 ↓
Pinia / API Module
 ↓
Axios Request
 ↓
Mock REST API
```

使页面逻辑更接近真实企业项目中的前后端分离开发模式。

### 请求状态处理

主要业务页面均考虑：

```text
Loading
Success
Empty
Error
Retry
```

避免接口请求期间出现无反馈或错误状态无法恢复的问题。

### 集中管理业务规则

候选人招聘阶段的推进、面试完成后的状态变化等规则统一维护，减少重复判断和状态不一致问题。

### 组件化

职位、候选人、面试等模块将表单弹窗和业务页面拆分，例如：

```text
PositionDialog
CandidateDialog
InterviewDialog
ProfileEditDialog
PasswordDialog
```

父组件负责 API 状态和业务流程，表单组件主要负责数据输入与事件触发。

### Tabs 路由管理

系统支持多页面 Tabs，并能够：

- 根据当前路由自动创建 Tab
- 浏览器前进 / 后退时同步状态
- 关闭当前 / 左侧 / 右侧 / 其他 / 全部标签
- 动态修改候选人详情 Tab 标题

---

## 响应式适配

HireFlow 主要面向桌面端招聘后台场景，同时针对不同屏幕宽度进行了基础响应式处理。

包括：

- 页面间距调整
- 筛选区域自动换行
- 表格区域适配
- Profile 页面布局切换
- 登录页移动端布局
- 侧边栏收缩

---

## 代码质量

项目目前通过：

```bash
pnpm lint
```

以及：

```bash
pnpm build
```

生产构建包含 TypeScript 类型检查：

```text
vue-tsc && vite build
```

---

## 数据与部署说明

当前项目使用：

```text
json-server + mock/db.json
```

模拟后端数据库。

本地开发时 Mock API 默认运行在：

```text
http://localhost:3300
```

在线演示的 Mock API 部署于 Render：

```text
https://hireflow-qd7r.onrender.com
```

因此需要注意：

- 在线 API 为 Mock REST API，并非真实生产后端
- 不包含真实数据库
- 不包含真实用户认证服务
- 不包含生产环境权限系统
- Render 免费服务长时间无访问后可能休眠
- 演示数据可能在服务重新部署或重启后恢复为初始数据

该设计主要用于完整展示前端 CRUD、状态管理、API 请求与业务流程能力。

---

## 后续可扩展方向

未来可以继续扩展：

- Spring Boot / Node.js 真实后端
- MySQL / PostgreSQL 数据库
- JWT 登录认证
- RBAC 权限管理
- 简历上传与解析
- 招聘消息通知
- 面试日历
- 招聘漏斗分析
- 操作日志
- 单元测试与 E2E 测试

---

## 项目总结

HireFlow 从一个通用后台管理项目基础结构出发，重新围绕招聘场景进行了业务设计和工程改造。

项目重点不在于单纯展示后台页面，而是实现：

```text
职位
 ↓
候选人
 ↓
面试
 ↓
招聘阶段
 ↓
Dashboard 数据统计
```

之间的数据关联和业务状态流转。

在开发过程中实践了 Vue 3、TypeScript、Pinia、Axios、REST API、组件化、路由管理、业务状态设计、异常状态处理和响应式布局等前端开发能力。
