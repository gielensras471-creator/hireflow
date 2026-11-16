# 部署前剩余阻断项

1. Owner单次补查并回传必要摘要：证书有效期/续期状态、所有相关location及rewrite优先级、V2 PM2实际cwd/解释器/启动文件/实例/停止预算、V2正在使用的数据路径、备份机制与可恢复产物、3300腾讯云安全组和主机防火墙是否限制公网、Render构建Node版本与完整deploy SHA/可回退deploy ID。
2. 已知Node达标、基本资源可用；独立用户/目录/端口尚未创建或授权，Linux原生启停、文件权限、WAL锁竞争、恢复库服务和真实Nginx HTTPS浏览器仍缺实测。维持NO-GO直到独立实例门禁完成。
3. 3300绑定所有地址存在潜在公网暴露面，但不能仅凭监听判定公网可达；本批不进行外部端口探测，也不改安全组。
4. Render跟踪main且On Commit；在任何未来推送或发布分支调整前，Owner须批准并先控制自动部署，再核对完整SHA；不把本地提交等同远程可部署。将命令改为冻结锁安装&&pnpm run build:v3，不能用分号掩盖安装失败；publish改dist-v3、API基址配置需要Owner另批。
5. V2真实一致性备份、恢复可用性和备份保管均未完成；有WAL不得只拷贝4KB主库。真实数据库路径须与运行进程关联确认后，才批准执行备份。V2 root/644为当前事实，不在本批擅自加固或变更权限。
6. A2客户端Origin白名单需采用实际Render URL；现有Nginx若已有CORS需避免重复头。Offer/资格请求终态/hired文案、原生缩放等保留项由总控裁决，不自动销项。

## 一次性剩余只读清单（Owner本机查看后脱敏，本轮未执行）

- nginx -v；在现有站点和其include中只摘取server_name/listen/location/rewrite/proxy_pass/CORS相关行，避免完整nginx -T公开私有配置。对已确认公开证书文件运行openssl x509 -in <证书> -noout -dates；查看Certbot续期定时器状态，不运行renew。
- root已运行PM2的现有安全查看视图：仅回传cwd、解释器路径/版本、脚本、fork/实例数、kill_timeout、其他共享服务；不要启动新PM2守护进程、不要输出env或完整jlist。
- Owner从现有部署配置私下核对V2 DATABASE_PATH，回传路径是否为已知路径；仅stat/df核对元数据。备份任务名称、最近成功及恢复记录的脱敏摘要即可，不打开或复制招聘数据。
- 腾讯云控制台安全组/防火墙入站规则及本机防火墙只读视图：仅80/443/3300相关允许范围，不实施任何探测或改规则。
- Render最近构建日志Node版本、完整deploy commit及上一成功deploy ID、回退产物是否仍可用；不点Deploy/Save/切分支。

这些结果可一次性回传，不需要逐条转达；权限不足仅记未知，不临时安装工具。
