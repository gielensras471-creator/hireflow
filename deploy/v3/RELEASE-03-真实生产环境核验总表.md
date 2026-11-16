# 真实生产环境核验总表

依据Owner本轮真实回传（未附服务器采集精确时间），Codex未远程复查；不是历史README推测。Ubuntu24.04.4/x86_64、2核、1.9GiB RAM/可用约1.4GiB、1.9GiB Swap、40GB ext4/余31GB；Node24.21.0 /usr/bin/node、pnpm12.4.2、PM2 7.0.4、Nginx1.24.0。Node已达>=24.15门槛，不需全局升级。资源具备小规模并行实例初步条件，但没有峰值负载/长期监测，不能保证正式容量；避免在该主机同时构建大型前端，可用固定版本的本地/Render产物。

80/443/3300监听，3300所有地址。V2 root PM2+Node合计RSS约165MiB；不能据此推断V3峰值。V3拟独立普通用户、回环3301、单fork PM2；V2 root PM2保持原状。

Nginx站点/etc/nginx/sites-available/hireflow-api，api.pixelweave.xyz；已知location /api/→http://127.0.0.1:3300/api/和转发头，Certbot配置存在；尚未取得完整路由优先级、证书有效期及续期状态。V2文件/var/lib/hireflow/hireflow.db 4KB、WAL121KB、SHM32KB，root属主，目录755/文件644；存在真实备份与当前进程使用该路径的证据仍未知。

Render Static Site hireflow-wed，https://hireflow-wed.onrender.com；main，短SHA490b9ee，Live；build为pnpm install --frozen-lockfile; pnpm run build，dist；Auto Deploy On Commit；/\*→/index.html；环境页面空，无显示的Secret Files/环境组。当前静态V2 API地址可能编译自仓库.env.production，不能由空环境页认定不使用API。短SHA需在正式切换前核对完整deploy ID/SHA与回退产物。

Owner决定V3全新空库、V2原库保留不迁移。A2已验收SHA dc28dba17eb8ba558120afdcf834329d1b4ba103；本批仅新增部署准备文件，不修改业务。
