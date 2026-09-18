import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import bcrypt from 'bcryptjs'
import { serverConfig } from '../config.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const serverRoot = path.resolve(__dirname, '..')
const dbPath = serverConfig.databasePath

fs.mkdirSync(path.dirname(dbPath), { recursive: true })

export const db = new DatabaseSync(dbPath)

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
`)

// Small compatibility helper so the existing route code can keep using
// db.transaction(() => { ... }) in the same way as before.
db.transaction = (callback) => {
  return (...args) => {
    db.exec('BEGIN')
    try {
      const result = callback(...args)
      db.exec('COMMIT')
      return result
    } catch (error) {
      try {
        db.exec('ROLLBACK')
      } catch {
        // Ignore rollback errors so the original error is preserved.
      }
      throw error
    }
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    department TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    department TEXT NOT NULL,
    location TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
    candidate_count INTEGER NOT NULL DEFAULT 0,
    publish_date TEXT NOT NULL,
    description TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    position TEXT NOT NULL,
    education TEXT NOT NULL,
    school TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT NOT NULL,
    stage TEXT NOT NULL CHECK (stage IN ('screening', 'first_interview', 'second_interview', 'offer', 'rejected')),
    owner TEXT NOT NULL,
    skills TEXT NOT NULL DEFAULT '',
    experience TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    applied_date TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS interviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    candidate_id INTEGER NOT NULL,
    candidate_name TEXT NOT NULL,
    position TEXT NOT NULL,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    interviewer TEXT NOT NULL,
    type TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK (status IN ('scheduled', 'completed', 'cancelled')),
    FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_candidates_stage ON candidates(stage);
  CREATE INDEX IF NOT EXISTS idx_candidates_position ON candidates(position);
  CREATE INDEX IF NOT EXISTS idx_interviews_candidate_id ON interviews(candidate_id);
  CREATE INDEX IF NOT EXISTS idx_interviews_date ON interviews(date);
`)

const seedPath = path.resolve(serverRoot, 'seed', 'seed-data.json')
const seedData = JSON.parse(fs.readFileSync(seedPath, 'utf8'))

const seedDatabase = db.transaction(() => {
  const counts = ['users', 'positions', 'candidates', 'interviews'].map((table) =>
    db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count
  )

  if (counts.some((count) => count > 0)) return

  const passwordHash = bcrypt.hashSync('123456', 10)
  db.prepare(`
    INSERT INTO users (username, password_hash, name, role, department, email, phone)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    'admin',
    passwordHash,
    '招聘管理员',
    '招聘管理员',
    '人力资源部',
    'admin@hireflow.com',
    '13800000000'
  )

  const insertPosition = db.prepare(`
    INSERT INTO positions (
      id, title, department, location, status, candidate_count, publish_date, description
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?
    )
  `)
  for (const item of seedData.positions) {
    insertPosition.run(
      item.id,
      item.title,
      item.department,
      item.location,
      item.status,
      item.candidateCount,
      item.publishDate,
      item.description
    )
  }

  const insertCandidate = db.prepare(`
    INSERT INTO candidates (
      id, name, position, education, school, phone, email, stage, owner,
      skills, experience, note, applied_date
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `)
  for (const item of seedData.candidates) {
    insertCandidate.run(
      item.id,
      item.name,
      item.position,
      item.education,
      item.school,
      item.phone,
      item.email,
      item.stage,
      item.owner,
      item.skills,
      item.experience,
      item.note,
      item.appliedDate
    )
  }

  const insertInterview = db.prepare(`
    INSERT INTO interviews (
      id, candidate_id, candidate_name, position, date, time, interviewer, type, note, status
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `)
  for (const item of seedData.interviews) {
    insertInterview.run(
      item.id,
      item.candidateId,
      item.candidateName,
      item.position,
      item.date,
      item.time,
      item.interviewer,
      item.type,
      item.note,
      item.status
    )
  }
})

seedDatabase()

export const databasePath = dbPath
