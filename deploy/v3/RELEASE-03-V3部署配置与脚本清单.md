# V3部署配置与脚本清单

| 文件                           | 实际用途/防误执行                                                                                                                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ecosystem.config.cjs           | 单fork、1实例、/usr/bin/node、独立cwd、kill_timeout15000>drain10000，无默认Secret；只能以后由普通服务用户运行。                                                                                                                 |
| nginx-location.conf.example    | 现有TLS server内新增/api/v3/，无URI proxy_pass至127.0.0.1:3301，保留前缀；不是完整站点，不自动安装。                                                                                                                            |
| v3.env.example                 | 仅示例占位，start:v3不会自动加载；真实值仅保护文件/进程环境。                                                                                                                                                                   |
| preflight.mjs                  | 解析配置、校验受审路径/端口/Node，不开库、不联网、不写库。                                                                                                                                                                      |
| backup-v2.mjs                  | 默认plan-only；执行必须--execute、明确源/目标和--authorization DEC-...；生产只接受固定V2路径和/var/backups/hireflow-v2中的新目标。SQLite只读快照+online backup、重开FK/完整性和全表逻辑摘要对比；拒绝覆盖，失败新目标可能保留。 |
| rollback-plan.mjs              | 无参数只打印提示；清单经门禁后仅打印步骤，绝不自动调用Render/Nginx/PM2。故不是一键生产回滚执行器。                                                                                                                              |
| rollback-manifest.example.json | 需实际回退deploy ID、Nginx快照和Owner决议；示例不可直接使用。                                                                                                                                                                   |
| tests/deploy-prep.test.js      | 仅虚构活跃WAL备份、覆盖/越界拒绝和PM2解析；Windows不冒充Linux权限测试。                                                                                                                                                         |

本地执行node --test tests/deploy-prep.test.js：4项，3通过、0失败、1明确跳过（POSIX路径配置需Linux）。Node --check和Prettier检查另存证据。Nginx真实语法与共享站点行为、PM2实际启停尚未本机验证，须目标主机独立实例阶段完成，不把配置可解析当作生产已验证。

备份脚本是可审查草案，只对小规模V2库准备；逻辑摘要会在内存读取行并散列，不输出记录，但处理真实数据仍须单独授权。无SQLite生产Schema假设之外的迁移功能，不调用V3专用验证器去备份V2。目标父目录必须预先由授权流程创建且0700，目标0600；不允许不受信任用户替换备份路径。DEC字符串为操作确认记录，脚本无法自动判断外部审批真实性。未获新批准不得执行生产参数。
