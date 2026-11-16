# V3 独立运行说明（RELEASE-02，本地生产等价验证）

本批仅实现方案 A 的本地适配；不构成预发布、正式发布或 V2 数据迁移授权。Node.js 至少 24.15.0，使用受控本机持久盘及独立进程。V2 的 build/start 和数据库保持不变。

## 四个独立动作

1. Owner/运维预先创建并授权 V3 数据根目录。Linux 目录应由运行用户持有且不可被组/其他用户写入，数据库仅该用户可读写；Windows 应使用独立服务账号和受限 NTFS ACL。代码拒绝网络共享、符号链接、硬链接及根目录外数据库。Windows Fixed 卷核查需要 PowerShell Get-Volume 可用；失败时拒绝，不自动降级。
2. 显式初始化新库：配置绝对 V3_DATA_ROOT、V3_DATABASE_PATH（根目录直接子文件，仅字母/数字/连字符/下划线及 .db）、非空 V3_INITIALIZER 后执行 `pnpm db:v3 init`。拒绝覆盖已有文件；没有账号、职位或候选人 Seed。只接受本批 fresh_v3_initialization 版本，不接受 V2 或历史迁移沙盒库。
3. 离线首个 HR：执行 `pnpm db:v3 first-hr`，通过 stdin 传入 JSON 的 username/name/password/role。role 仅 hr 或 招聘管理员；password 为 12～72 UTF-8 字节。只能在 users 为空时创建，bcrypt cost=12。请使用受控本地输入或文件描述符，不在命令参数、Shell 历史、日志或证据里放明文密码；本工具不打印输入。生产进程永不自动创建管理员。
4. 普通启动：配置 NODE*ENV=production、V3_DATA_ROOT、V3_DATABASE_PATH、V3_JWT_SECRET（至少 32 字节、高熵且稳定）、V3_PORT 后执行 `pnpm start:v3`。缺配置、缺文件、非合法 V3 结构/版本/完整性/事件回执关系均拒绝。JWT Secret 由服务端受控环境供给，不自动读取 .env，不放入 VITE*\*；轮换将使旧 token 失效，应另行安排。

## 前端与代理

`pnpm build:v3` 输出 dist-v3，真正 production 构建（DEV=false）；`pnpm build` 继续输出 V2 dist。不要混用两个产物。V3 Axios 固定同源 /api/v3。

可选将 V3_STATIC_DIR 配为 dist-v3 的绝对路径，由独立 V3 Express 同源提供静态文件和非 API SPA 深链 fallback。静态目录不得包含数据根目录。GET /api/v3/health 为最小存活检查，GET /api/v3/ready 为已完成数据库和 HR 门禁且服务未 drain 的就绪检查。未知 /api 路径返回 JSON 404，不 fallback 到 HTML。

服务默认且固定绑定 127.0.0.1，必须由后续经批准的 HTTPS 反向代理接入。最小 Nginx 方案为独立 V3 host，全部路径代理至该本机端口（包括 SPA 深链），保留 Host/X-Forwarded-Proto，禁止公开数据目录。此文不修改实际 Nginx/PM2；端口、域名、证书、防火墙和进程用户需后续授权核实。

建议单个 fork 实例持有一个 V3 文件库，不与 V2、网络盘或多个 PM2 cluster worker 共享。PM2 启动 server/index-v3.js，明确工作目录与上述环境，避免继承 V2 的默认启动命令。Linux SIGINT/SIGTERM 进入同一 close()：先拒绝新请求，等待连接退出，最多 V3_SHUTDOWN_MS（默认10000、1000～30000），超时断开连接，再关库；PM2 kill_timeout 应大于此预算。Windows 强制结束进程不能冒充原生信号优雅退出；本地已另用子进程调用 close() 验证排空和释放，实际 Linux/PM2 信号仍需预发布验证。

## 持久库、备份和恢复

固定冻结 Schema 指纹、版本记录、初始化执行者及随机数据库身份，源 Schema 脚本指纹按 LF 规范化。启动检查 FK/完整性、事件回执关联、文件身份、仅 main/temp、无临时对象；WAL + synchronous=FULL + busy_timeout=5000。已有库必须已经为 WAL；启动不通过改写 V2 journal 模式来“修复”不合格库。禁止 ATTACH/DETACH 和连接安全 PRAGMA 降级。

备份：将 V3_SNAPSHOT_PATH 指定为同一受控根目录下一个不存在的新 .db 文件，执行 `pnpm db:v3 backup`。使用 SQLite online backup API 和源只读快照，不是复制主 db。目标重新打开，核验 Schema、版本、完整性、FK、事件回执和全表数据摘要。

恢复：V3_SNAPSHOT_PATH 为已验证备份源，V3_DATABASE_PATH 为不存在的新目标，执行 `pnpm db:v3 restore`。仍使用 backup API 并重新核验；不得覆盖活跃库。源失败不会删除或覆盖源；失败的新目标保留供检查，不自动清理。切换服务至恢复库、停机和回滚仍需 Owner 单独授权。备份与恢复不会自动改变服务配置或生产文件。

数据回滚与代码回滚必须独立审批。本批不实现 V2→V3 真实迁移，不修改既有迁移沙盒，也不读取真实数据。备份应受与源库同等权限保护；异机加密保管、磁盘空间监控、备份保留和灾备演练由后续发布门禁确认。

## 尚需发布门禁

Linux/PM2 原生信号、NTFS/服务器 ACL、实际持久卷、HTTPS/Nginx、域名、稳定 Secret 注入与轮换、真实备份保管策略尚未线上验证。原生200%缩放、真机、读屏既有边界保持。不要把本批本地通过等同于生产 Go。
