# HireFlow 招聘流程协作平台

HireFlow 是一个围绕职位、候选人、面试与招聘阶段流转构建的前后端分离招聘协作项目。

V2.1 在 V2.0 前端工程重构的基础上，将原来的 `json-server` Mock API 替换为真正的 **Node.js + Express + SQLite + JWT** 后端，实现登录认证、业务数据持久化、用户资料与密码修改，以及职位 / 候选人 / 面试 RESTful CRUD。

## 在线与仓库

- Frontend Demo: https://hireflow-wed.onrender.com
- GitHub: https://github.com/gielensras471-creator/hireflow

> V2.1 后端部署完成前，线上 Demo 可能仍指向旧版本服务。生产部署时需要把 `.env.production` 中的 API 地址替换为实际 Express 服务地址。

## 演示账号

```text
账号：admin
密码：123456
```

数据库首次启动时会自动创建该账号，并使用 bcrypt 哈希存储密码。

---

## V2.1 核心升级

### 真实后端 API

```text
Vue 3 / TypeScript
        ↓ Axios + Bearer Token
Node.js / Express
        ↓
SQLite
```

主要接口：

```text
POST   /api/auth/login
GET    /api/auth/me

GET    /api/profile
PATCH  /api/profile
PATCH  /api/profile/password

GET    /api/positions
POST   /api/positions
PATCH  /api/positions/:id
DELETE /api/positions/:id

GET    /api/candidates
GET    /api/candidates/:id
POST   /api/candidates
PATCH  /api/candidates/:id
DELETE /api/candidates/:id

GET    /api/interviews
GET    /api/interviews/:id
POST   /api/interviews
PATCH  /api/interviews/:id
DELETE /api/interviews/:id
```

### JWT 登录认证

登录成功后后端签发 JWT：

- 普通登录：12 小时
- “7 天内保持登录”：7 天
- Axios 请求拦截器自动附加 `Authorization: Bearer <token>`
- 后端认证中间件统一校验受保护 API
- Token 失效后前端自动清除本地会话并返回登录页

### SQLite 数据持久化

数据库文件默认生成在：

```text
server/data/hireflow.db
```

首次运行时自动建表并写入演示数据：

```text
users
positions
candidates
interviews
```

本地数据库文件已加入 `.gitignore`，不会提交到 GitHub。

### 账号资料与密码

个人中心不再只修改前端内存状态：

- 用户资料通过 Express API 持久化到 SQLite
- 修改密码会验证当前密码
- 新密码使用 bcrypt 重新哈希后保存

---

## 前端技术栈

| 技术 | 用途 |
| --- | --- |
| Vue 3 | 核心框架 |
| TypeScript | 类型约束 |
| Pinia | 状态管理 |
| Vue Router | 路由与鉴权 |
| Axios | HTTP 请求与 Token 拦截 |
| Element Plus | UI 组件 |
| ECharts | 数据可视化 |
| Vite | 开发与构建 |
| Sass | 样式 |

## 后端技术栈

| 技术 | 用途 |
| --- | --- |
| Node.js | JavaScript 服务端运行时 |
| Express | REST API |
| SQLite | 本地关系型数据持久化 |
| node:sqlite | Node.js 24 内置 SQLite 接口，无需额外原生驱动 |
| jsonwebtoken | JWT 签发与校验 |
| bcryptjs | 密码哈希与验证 |
| cors | 跨域配置 |
| dotenv | 后端环境变量 |

---

## 项目结构

```text
hireflow/
├─ server/
│  ├─ db/
│  │  └─ database.js
│  ├─ middleware/
│  │  ├─ auth.js
│  │  └─ error.js
│  ├─ routes/
│  │  ├─ auth.js
│  │  ├─ candidates.js
│  │  ├─ interviews.js
│  │  ├─ positions.js
│  │  └─ profile.js
│  ├─ seed/
│  │  └─ seed-data.json
│  ├─ scripts/
│  │  └─ reset-db.js
│  ├─ utils/
│  ├─ data/
│  ├─ .env.example
│  └─ index.js
│
├─ src/
│  ├─ api/
│  ├─ layouts/
│  ├─ router/
│  ├─ stores/
│  ├─ styles/
│  ├─ types/
│  ├─ utils/
│  └─ views/
├─ docs/
├─ public/
├─ package.json
└─ vite.config.ts
```

---


> V2.1.1 使用 Node.js 内置 `node:sqlite`，建议使用 **Node.js 24.15+**。这样无需安装 Visual Studio C++ Build Tools。

## 本地运行

### 1. 安装依赖

```bash
pnpm install
```

### 2. 启动 Express API

打开第一个终端：

```bash
pnpm api
```

默认地址：

```text
http://localhost:3300
```

健康检查：

```text
GET http://localhost:3300/api/health
```

开发时如果希望修改后端代码自动重启：

```bash
pnpm api:dev
```

### 3. 启动 Vue 前端

打开第二个终端：

```bash
pnpm dev
```

Vite 默认运行在：

```text
http://localhost:5173
```

开发环境下 `/api` 会由 Vite 代理到 `http://localhost:3300`。

### 4. 生产构建

```bash
pnpm build
```

### 5. 重置数据库

如需恢复初始演示数据：

```bash
pnpm db:reset
pnpm api
```

---

## 后端环境变量

开发环境可复制：

```text
server/.env.example
```

为：

```text
server/.env
```

示例：

```env
PORT=3300
CLIENT_ORIGIN=http://localhost:5173
JWT_SECRET=replace-with-a-long-random-secret-before-production
```

> 生产环境必须使用随机且足够长的 `JWT_SECRET`，不要使用默认开发密钥。

---

## 核心业务功能

- Dashboard 招聘数据概览
- 职位新增 / 编辑 / 删除 / 开启关闭
- 候选人新增 / 编辑 / 删除 / 搜索筛选 / 详情
- 招聘阶段：筛选 → 初面 → 复面 → Offer / 淘汰
- 面试安排 / 编辑 / 完成 / 取消 / 删除
- 路由鉴权
- JWT 登录
- 用户资料持久化
- 密码修改
- Loading / Empty / Error / Retry 状态
- 多标签页与候选人详情动态 Tab
- 响应式适配

---

## V2.1 的工程价值

V2.0 主要证明 Vue 3 / TypeScript 前端业务与工程能力；V2.1 将项目补全为真正的前后端分离应用：

```text
页面组件
  ↓
Pinia / API Module
  ↓
Axios Request
  ↓
JWT Middleware
  ↓
Express Route
  ↓
SQLite
```

因此职位、候选人、面试、用户资料和账号密码都不再依赖静态 Mock 数据，而是经过真实 HTTP API 和数据库持久化完成。

## 后续计划

- V2.2：后端参数校验、单元测试 / E2E、API 文档、前端分包与性能优化
- MySQL / PostgreSQL 数据库迁移
- RBAC 权限模型
- 操作日志
- 简历上传与解析
