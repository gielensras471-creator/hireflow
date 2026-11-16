// Plan printer only: Render rollback requires an authorized console action.
import fs from 'node:fs'
const file = process.argv[2]
if (!file) {
  console.log('PLAN ONLY. Supply an approved rollback manifest; no remote actions performed.')
  process.exit(0)
}
const m = JSON.parse(fs.readFileSync(file, 'utf8'))
if (
  !/^DEC-[A-Z0-9-]+$/.test(m.authorization ?? '') ||
  !/^[a-f0-9]{40}$/.test(m.v2Sha ?? '') ||
  !m.renderDeployId ||
  !m.nginxSnapshot ||
  m.v2Database !== '/var/lib/hireflow/hireflow.db'
)
  throw Error('Incomplete reviewed rollback manifest')
console.log(
  JSON.stringify({
    mode: 'plan-only',
    writes: false,
    steps: [
      'Owner restricts new V3 writes under separate approval',
      'Preserve uncertain commands and consistent V3 backup under separate approval',
      'Owner restores exact V2 Render artifact and separately its rewrite/header/build settings',
      'Keep V2 root PM2 and original DB unchanged; do not run pm2 restart all',
      'If needed restore reviewed Nginx config, test then reload only under explicit approval',
      'Verify original URL and V2 health; retain V3 data for later reconciliation'
    ],
    v2Sha: m.v2Sha
  })
)
