import fs from 'node:fs'
import bcrypt from 'bcryptjs'

export const loadSeedData = () =>
  JSON.parse(fs.readFileSync(new URL('../seed/seed-data.json', import.meta.url), 'utf8'))

export const seedDatabase = (db, seedData) => {
  const seed = db.transaction(() => {
    const counts = ['users', 'positions', 'candidates', 'interviews'].map(
      (table) => db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count
    )

    if (counts.some((count) => count > 0)) return

    const passwordHash = bcrypt.hashSync('123456', 10)
    db.prepare(
      `
    INSERT INTO users (username, password_hash, name, role, department, email, phone)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `
    ).run(
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
  seed()
}
