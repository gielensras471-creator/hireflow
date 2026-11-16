import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { snapshotDatabase } from './backup-core.mjs'
export async function backupV2(options = {}) {
  const { source, destination, authorization, execute = false } = options
  if (!execute) return { mode: 'plan-only', writes: false }
  if (
    Object.keys(options).some(
      (k) => !['source', 'destination', 'authorization', 'execute'].includes(k)
    )
  )
    throw Error('No sandbox/unknown option allowed')
  if (
    !/^DEC-[A-Z0-9-]+$/.test(authorization ?? '') ||
    process.platform !== 'linux' ||
    source !== '/var/lib/hireflow/hireflow.db' ||
    !path.isAbsolute(destination) ||
    path.dirname(destination) !== '/var/backups/hireflow-v2'
  )
    throw Error('Unreviewed production target')
  return { ...(await snapshotDatabase(source, destination)), authorization }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = {},
      args = process.argv.slice(2),
      map = {
        '--source': 'source',
        '--destination': 'destination',
        '--authorization': 'authorization'
      }
    for (let i = 0; i < args.length; i++) {
      const flag = args[i],
        key = flag === '--execute' ? 'execute' : map[flag]
      if (!key || Object.hasOwn(options, key)) throw Error('Unknown or duplicate argument')
      if (key === 'execute') options.execute = true
      else {
        const value = args[++i]
        if (!value || value.startsWith('--')) throw Error('Missing argument')
        options[key] = value
      }
    }
    console.log(JSON.stringify(await backupV2(options)))
  } catch {
    console.error(
      'V2 backup refused; source retained, inspect any new target without overwriting it'
    )
    process.exitCode = 1
  }
}
