# 独立部署与回滚操作手册

以下为未来授权后的操作手册，所有命令本轮均未在服务器执行。不得整段盲目粘贴。只允许先独立实例，不自动切换网站。

## 一次性授权单元

A：剩余只读核验；B：批准独立普通用户/目录、保护环境、冻结产物、独立PM2及虚构库测试；C：批准V2真实一致性备份和恢复核验；D：批准受限Nginx测试入口与HTTPS验证；E：固定SHA及回滚清单通过后单独批准正式Render切换。B/C/D可以在批准的完整清单内连续执行，不需每一步人工转达；E不得从B自动推定。

## 用户和目录（仅B获批后）

建议专用普通用户hireflow-v3，独立home /home/hireflow-v3（用于PM2和环境），代码/srv/hireflow-v3/releases/<最终批准SHA>，数据/var/lib/hireflow-v3，日志/var/log/hireflow-v3，保护配置/etc/hireflow-v3。先确认用户/目录不存在或用途一致，有冲突即停。管理员可按批准路径执行useradd --create-home --shell /bin/bash hireflow-v3；install -d分别创建上述目录，数据与配置0700、代码/日志权限按运行需求最小化，属主hireflow-v3。不要chown V2或系统Node目录，不创建或重置现有用户，不把数据放进release/dist中。

真实runtime.env仅授权管理员写入保护文件，文件属hireflow-v3且0600；不得把示例占位当Secret。通过可信保护的Shell环境或进程配置加载（例如专用用户终端set -a后source可信runtime.env，再set +a），不要把密钥写在命令参数、报告、Git或VITE变量。PM2会保存进程环境，PM2_HOME同样保护，禁止转储发聊天。

确认 /usr/bin/node --version 为24.21.0；使用该绝对解释器，不改全局Node。依赖遵循锁文件，服务器pnpm12.4.2与锁格式兼容仍需在独立release验证，失败停下，不重写锁或升级V2依赖。建议前端在Render或本地按最终SHA构建，避免2GiB服务器构建峰值。

## 新库/独立启动（B获批后）

以hireflow-v3身份、受保护V3环境执行preflight.mjs；核对release目录实际Git SHA或产物清单与批准版本。预检不验证网络/实际权限，随后仍需目标主机门禁。db:v3 init需显式V3_INITIALIZER和不存在的fresh.db；db:v3 first-hr使用受控stdin，无默认密码或命令回显。不能运行V2 seed/reset。

以同一服务用户、独立PM2_HOME=/home/hireflow-v3/.pm2，使用已有PM2可执行路径（先核对）启动ecosystem.config.cjs，仅--only hireflow-v3。不得使用root PM2上下文、pm2 restart all、pm2 update或覆盖原dump。自启/systemd配置另审，不执行全局pm2 startup/save。先以虚构库验证health/ready、SIGINT/SIGTERM、异常恢复、稳定JWT、权限、WAL与恢复；本地模板只保证fork=1。

## 备份（C获批后）

确认V2实际使用已知路径后，为备份创建受控/var/backups/hireflow-v2（0700，仅获批执行者可读）；记录授权、维护策略和存储预算。示例：node deploy/v3/backup-v2.mjs --source /var/lib/hireflow/hireflow.db --destination /var/backups/hireflow-v2/APPROVED_NEW_NAME.db --authorization DEC-具体批准决议 --execute。源只读SQLite快照，online backup处理WAL并重开核验，非简单文件复制。脚本不写生产源，但会创建新备份文件/读取真实数据，必须单独授权。失败保留新目标供检查，不覆盖或自动删除。备份应在隔离恢复位置验证应用可读，不在原库上恢复；备份包含真实隐私，禁止上传聊天。

## Nginx与Render（D/E分别批准）

人工review片段与现有TLS server安全规则后插入/api/v3/；^~会影响正则location优先级，必须确保不绕过既有访问限制。保留原/api/→3300，3301只回环；nginx -t及后续reload都在具体授权下执行，先隔离入口，不误切原站点。CORS由V3应用唯一负责。证书续期和权限先补查，不自动改证书。

Render发布前先按批准方案暂停/控制On Commit自动部署，防止未来push main提前上线；完整版本/产物可审查后，Build Command为pnpm install --frozen-lockfile && pnpm run build:v3，Publish Directory为dist-v3；Node固定满足>=24.15.0；构建变量VITE_HIREFLOW_V3_API_URL=https://api.pixelweave.xyz/api/v3。后端V3_CLIENT_ORIGINS为精确Render Origin。保留/\*→/index.html，不把API误写到SPA。main当前V2构建，不能仅改命令就认为该分支已有V3源码；切换来源分支/SHA或推送本地候选必须独立批准，不以合并main作为默认步骤。

## 回滚

先记录确切V2 Render deploy ID/完整SHA、原构建参数/环境/rewrite/header和Nginx已知良好配置。rollback-plan.mjs是本地清单校验/打印器，不执行远程变更。填入获批清单后运行node deploy/v3/rollback-plan.mjs <manifest>可检查操作顺序。

回滚触发：核心认证/写入不可达、错库/错误路由、持续5xx/CORS故障、审计不一致或V2受影响。按预先授权限制新V3写入，保留未决命令及V3一致性备份；恢复原Render V2产物及其独立rewrite/header设置，确认/api/仍到原V2 root进程/原库；如需复原Nginx先检查再按授权reload。不重启root PM2，不把V3库交给V2，不反向迁移。V3新增记录保留并由Owner决定后续业务处理。正常生产冒烟、观察窗、责任人和恢复点均发布前确定。

本轮交付的是可审核配置/草案，Linux及生产配置尚未执行验证，不声称已具备未经复核的一键上线能力。
