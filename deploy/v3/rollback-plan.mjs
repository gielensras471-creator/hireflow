import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { noLinks } from './release-identity.mjs'
const sha = (v) => /^[a-f0-9]{40}$/.test(v ?? '')
export function validateManifest(m) {
  if (/REPLACE|PLACEHOLDER|APPROVED_SHA|<|>/i.test(JSON.stringify(m)))
    throw Error('Placeholder remains')
  if (
    !/^DEC-[A-Z0-9-]+$/.test(m.authorization ?? '') ||
    !sha(m.v2Sha) ||
    !/^dep-[a-z0-9]{10,64}$/.test(m.renderDeployId ?? '') ||
    m.v2Database !== '/var/lib/hireflow/hireflow.db'
  )
    throw Error('Invalid rollback fields')
  for (const item of [m.nginxSnapshot, m.renderEvidence]) {
    if (
      !item ||
      !/^\/var\/backups\/hireflow-deploy\/rollback\/[A-Za-z0-9_-]+\.(conf|json)$/.test(
        item.path ?? ''
      ) ||
      !/^([a-f0-9]{64})$/.test(item.sha256 ?? '')
    )
      throw Error('Unsafe evidence reference')
  }
  return { formatValidated: true, resourcesVerified: false }
}
export function evidenceFile(file, hash) {
  noLinks(file)
  const st = fs.lstatSync(file)
  if (!st.isFile() || st.nlink !== 1) throw Error('Unsafe evidence file')
  const b = fs.readFileSync(file)
  if (createHash('sha256').update(b).digest('hex') !== hash) throw Error('Evidence hash mismatch')
  return b
}
export function rollbackPlan(m) {
  validateManifest(m)
  if (process.platform !== 'linux') throw Error('POSIX resource checks require Linux')
  evidenceFile(m.nginxSnapshot.path, m.nginxSnapshot.sha256)
  const e = JSON.parse(evidenceFile(m.renderEvidence.path, m.renderEvidence.sha256))
  if (
    e.deployId !== m.renderDeployId ||
    e.sha !== m.v2Sha ||
    e.available !== true ||
    e.verifiedBy !== 'Owner' ||
    !Number.isFinite(Date.parse(e.verifiedAt)) ||
    Date.parse(e.verifiedAt) > Date.now()
  )
    throw Error('Rollback resource attestation missing')
  return {
    mode: 'plan-only',
    writes: false,
    formatValidated: true,
    localEvidenceHashesVerified: true,
    remoteAvailabilityIndependentlyVerified: false,
    steps: [
      'Owner restricts V3 writes under authorization',
      'Preserve V3 consistent backup and uncertain requests',
      'Owner restores exact Render V2 artifact and separately configuration',
      'Keep V2 root PM2 and original DB unchanged',
      'Restore reviewed Nginx only after test and separate reload authorization',
      'Verify V2 entry and retain V3 data'
    ]
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (!process.argv[2]) console.log('PLAN ONLY: supply reviewed manifest; no remote actions')
    else
      console.log(
        JSON.stringify(rollbackPlan(JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))))
      )
  } catch {
    console.error('Rollback plan refused: fields or resource evidence unverified')
    process.exitCode = 1
  }
}
