import { createHash } from 'node:crypto'

const sql =
  'ALTER TABLE users ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 1 CHECK(auth_version BETWEEN 1 AND 9007199254740991)'

export const authMigrationVersion = 'v3_auth_002'
export const authMigrationHash = createHash('sha256').update(sql).digest('hex')
export const authSchemaFingerprint =
  'd7014f07978dbf91e1a42f69207f97cd4d91f2fe86840313d80cdd4bcfa516ca'

export const addV3AuthVersion = (db) => db.exec(sql)
