// Template: load only as the dedicated hireflow-v3 service user after authorization.
const path = require('node:path')
const cwd = process.env.V3_RELEASE_DIR
if (!cwd || !path.isAbsolute(cwd)) throw Error('Explicit absolute V3_RELEASE_DIR required')
if (!process.env.V3_JWT_SECRET || process.env.V3_JWT_SECRET === 'REPLACE_WITH_APPROVED_SECRET')
  throw Error('Provide protected server-side secret')
module.exports = {
  apps: [
    {
      name: 'hireflow-v3',
      cwd,
      script: 'server/index-v3.js',
      interpreter: '/usr/bin/node',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      min_uptime: '10s',
      max_restarts: 5,
      restart_delay: 3000,
      kill_timeout: 15000,
      env: { NODE_ENV: 'production' },
      time: true
    }
  ]
}
