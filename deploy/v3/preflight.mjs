import fs from 'node:fs'
import os from 'node:os'
import { releasePath, noLinks, gitIdentity } from './release-identity.mjs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveV3Config } from '../../server/config-v3.js'
export function check(env) {
  releasePath(env.V3_RELEASE_DIR, env.V3_EXPECTED_SHA)
  if (
    process.platform !== 'linux' ||
    os.userInfo().username !== 'hireflow-v3' ||
    process.getuid() === 0
  )
    throw Error('Unknown service identity')
  const codeVersion = gitIdentity(env.V3_RELEASE_DIR, env.V3_EXPECTED_SHA)
  const cfg = resolveV3Config(env)
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major < 24 || (major === 24 && minor < 15)) throw Error('Node >=24.15 required')
  if (cfg.port !== 3301 || cfg.shutdownMs !== 10000)
    throw Error('Reviewed port/drain budget required')
  if (
    cfg.root !== '/var/lib/hireflow-v3' ||
    cfg.file !== '/var/lib/hireflow-v3/fresh.db' ||
    cfg.staticDir
  )
    throw Error('Reviewed isolated V3 paths required')
  if (env.V3_JWT_SECRET === 'REPLACE_WITH_APPROVED_SECRET')
    throw Error('Placeholder secret refused')
  if (!env.V3_RELEASE_DIR || !path.isAbsolute(env.V3_RELEASE_DIR))
    throw Error('Release directory required')
  for (const dir of [env.V3_RELEASE_DIR, cfg.root]) {
    noLinks(dir)
    const st = fs.statSync(dir)
    if (!st.isDirectory() || st.uid !== process.getuid() || (st.mode & 0o022) !== 0)
      throw Error('Unknown directory ownership')
  }
  return {
    codeVersion,
    runtimeEnvironment: 'Node/config/user/directory metadata only; DB not opened; port not probed',
    host: cfg.host,
    port: cfg.port,
    database: cfg.file,
    clientOrigins: cfg.clientOrigins,
    secret: 'present; value withheld',
    databaseOpened: false
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    console.log(JSON.stringify(check(process.env)))
  } catch {
    console.error('V3 preflight refused: check reviewed paths, version and protected configuration')
    process.exitCode = 1
  }
}
