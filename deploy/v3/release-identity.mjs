import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
export function releasePath(dir, sha) {
  if (!/^[a-f0-9]{40}$/.test(sha ?? '') || dir !== '/srv/hireflow-v3/releases/' + sha)
    throw Error('Unapproved release path or SHA')
  return dir
}
export function noLinks(p) {
  if (!path.isAbsolute(p) || path.resolve(p) !== p) throw Error('Noncanonical path')
  let part = path.parse(p).root
  for (const name of p.slice(part.length).split(path.sep).filter(Boolean)) {
    part = path.join(part, name)
    if (fs.lstatSync(part).isSymbolicLink()) throw Error('Linked path')
  }
  if (fs.realpathSync(p) !== p) throw Error('Realpath mismatch')
}
export function gitIdentity(dir, sha) {
  noLinks(dir)
  const run = (...a) =>
    execFileSync('git', ['--no-optional-locks', '-C', dir, ...a], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim()
  if (
    path.resolve(run('rev-parse', '--show-toplevel')) !== path.resolve(dir) ||
    run('rev-parse', 'HEAD') !== sha ||
    run('status', '--porcelain', '--untracked-files=all')
  )
    throw Error('Version or clean tree unverified')
  for (const relative of run('ls-files', '-z').split('\0').filter(Boolean)) {
    const file = path.resolve(dir, relative)
    if (!file.startsWith(dir + path.sep)) throw Error('Tracked path escape')
    noLinks(file)
  }
  return { method: 'Git SHA + clean tree', sha }
}
