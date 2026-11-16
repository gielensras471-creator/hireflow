# 部署工具安全收口报告

基线0b3e67b81f323896d5fd7ea23a78edfa4178c1ac；本批独立分支codex/release-03-deploy-harden。只修改部署工具、示例和专项测试，不修改V2/V3业务或Schema。

## 修正边界

- preflight：必须V3_EXPECTED_SHA为获批40位SHA，目录严格等于/srv/hireflow-v3/releases/<SHA>，拒绝非规范路径/V2/逃逸；拒绝发布目录和受Git跟踪文件链接，实际Git根/HEAD/干净状态必须一致。不支持无Git元数据的产物包，若未来采用产物清单需单独审查，不能绕过版本门禁。代码版本检查与Node/环境/用户/目录检查分别报告；必须Linux普通用户hireflow-v3、非root，发布/数据目录由该用户持有且不可组/其他用户写。仍核对3301、127.0.0.1、独立数据根及关闭预算，不开库、不建文件、不探测端口。依赖目录正确性及真实端口仍需Linux门禁，不能称预检等于运行验证。
- backup-v2：生产CLI不再接受sandboxRoot，未知/重复参数或--execute false等歧义输入直接拒绝；默认仍plan-only。受固定生产源/备份目录、显式--execute和Owner决议门禁约束。通用backup-core只是内部快照引擎供虚构测试，不是带sandbox开关的生产入口；直接导入引擎也属于需要审批的真实数据库读取/备份操作，不是安全边界绕行许可。
- 快照引擎在只读连接的同一读事务内核验完整性/FK/Schema与排序后的全表逻辑摘要，SQLite online backup处理活跃WAL，独立重开校验目标。无rowid排序假设，覆盖WITHOUT ROWID、rowid同名列、Blob和大整数。目标wx保留、不覆盖，路径/链接/文件身份检查；失败可能留下新目标，不自动清理。sourceUnchanged声明删除，改为仅陈述源连接只读，明确未独立证明源在并发写入期间不变。
- rollback：拒绝占位符、错误SHA、非dep-格式Deploy ID、非受控路径、缺少SHA256；校验本地Nginx快照及Render可回退证据文件完整性。Render证据须有一致deployId/SHA、Owner、verifiedAt和available=true。格式合格、已有本地证据、远程实时可用性是三种不同结论；本工具不独立证明远程资源仍在，更不执行回滚。快照目录为/var/backups/hireflow-deploy/rollback，部署时需先授权创建/受限保管。

## 本地实际验证

node --test tests/deploy-prep.test.js：11项，9通过、0失败、2跳过。Windows纯POSIX路径字符串、实际临时Git版本/干净树/目录junction拒绝、PM2模板解析、CLI拒绝、清单/证据hash测试通过。源夹具复用实际server/db/schema.js，在活跃WAL备份挂起时由另一写连接提交虚构职位，恢复快照保持写入前状态、源保持写入后状态。测试包括无个人资料V2 Schema及附加不同表结构；失败源内容仍可读取，已有目标未被覆盖。

两项未实测：完整Linux服务用户/权限/发布路径正向预检；Windows无文件符号链接权限，文件symlink拒绝测试明确跳过。目录junction拒绝实际通过，不冒充Linux symlink测试。没有Linux真实权限、PM2启停或Nginx语法环境。本批不重跑36AC。初轮测试错误日志保留（SQLite setReadBigInts不是可链式API、虚构非法FK夹具需显式关FK、旧sandbox用例需迁至内部引擎），修正后断言通过，没有删减业务断言。

## 使用前的新要求

V3_EXPECTED_SHA及目录名必须与最终获批代码一致；候选需保留真实Git元数据且干净。禁止从旧环境复制不匹配的SHA。回滚清单现在需要结构化nginxSnapshot/renderEvidence及SHA256，旧仅字符串清单不再接受。v3.env.example和rollback-manifest.example.json已更新，占位示例本来就不能执行。

授权单元见下一文档。未Push、Merge、Deploy，未访问生产或清理历史。最终SHA及Diff/原始测试见本轮证据索引。
