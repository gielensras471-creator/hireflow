import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  initializeV3File,
  initializeFirstHr,
  backupV3File,
  restoreV3File
} from '../db/persistent-v3.js'
export async function runDatabaseTool(command, env, input) {
  const root = env.V3_DATA_ROOT,
    file = env.V3_DATABASE_PATH
  if (command === 'init') return initializeV3File(root, file, env.V3_INITIALIZER)
  if (command === 'first-hr') {
    initializeFirstHr(root, file, input)
    return { status: 'provisioned' }
  }
  if (command === 'backup') return backupV3File(root, file, env.V3_SNAPSHOT_PATH)
  if (command === 'restore') return restoreV3File(root, env.V3_SNAPSHOT_PATH, file)
  throw new Error('Unknown V3 offline operation')
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    let input
    if (process.argv[2] === 'first-hr') {
      let text = ''
      for await (const chunk of process.stdin) {
        text += chunk
        if (Buffer.byteLength(text) > 4096) throw new Error('Input too large')
      }
      input = JSON.parse(text)
    }
    await runDatabaseTool(process.argv[2], process.env, input)
    console.log('V3 offline operation completed')
  } catch {
    console.error('V3 offline operation refused')
    process.exitCode = 1
  }
}
