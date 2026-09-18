import { Router } from 'express'
import { db } from '../db/database.js'
import { asyncHandler, parseId, requireFields } from '../utils/http.js'

const router = Router()
const validStages = ['screening', 'first_interview', 'second_interview', 'offer', 'rejected']

const selectSql = `
  SELECT
    id,
    name,
    position,
    education,
    school,
    phone,
    email,
    stage,
    owner,
    skills,
    experience,
    note,
    applied_date AS appliedDate
  FROM candidates
`

const getCandidate = (id) => db.prepare(`${selectSql} WHERE id = ?`).get(id)

const adjustPositionCount = (title, delta) => {
  if (!title || delta === 0) return

  db.prepare(`
    UPDATE positions
    SET candidate_count = MAX(0, candidate_count + ?)
    WHERE title = ?
  `).run(delta, title)
}

router.get('/', (_req, res) => {
  res.json(db.prepare(`${selectSql} ORDER BY applied_date DESC, id DESC`).all())
})

router.get('/:id', (req, res) => {
  const row = getCandidate(parseId(req.params.id))
  if (!row) return res.status(404).json({ message: '候选人不存在' })
  res.json(row)
})

router.post(
  '/',
  asyncHandler(async (req, res) => {
    requireFields(req.body, [
      'name',
      'position',
      'education',
      'school',
      'phone',
      'email',
      'stage',
      'owner',
      'appliedDate'
    ])

    if (!validStages.includes(req.body.stage)) {
      return res.status(400).json({ message: '候选人阶段无效' })
    }

    const createCandidate = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO candidates (
          name, position, education, school, phone, email, stage, owner,
          skills, experience, note, applied_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        String(req.body.name).trim(),
        String(req.body.position).trim(),
        String(req.body.education).trim(),
        String(req.body.school).trim(),
        String(req.body.phone).trim(),
        String(req.body.email).trim(),
        req.body.stage,
        String(req.body.owner).trim(),
        String(req.body.skills || ''),
        String(req.body.experience || ''),
        String(req.body.note || ''),
        String(req.body.appliedDate)
      )

      adjustPositionCount(String(req.body.position).trim(), 1)
      return Number(result.lastInsertRowid)
    })

    const id = createCandidate()
    res.status(201).json(getCandidate(id))
  })
)

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id)
    const current = getCandidate(id)
    if (!current) return res.status(404).json({ message: '候选人不存在' })

    const next = { ...current, ...req.body }
    if (!validStages.includes(next.stage)) {
      return res.status(400).json({ message: '候选人阶段无效' })
    }

    const updateCandidate = db.transaction(() => {
      db.prepare(`
        UPDATE candidates
        SET name = ?, position = ?, education = ?, school = ?, phone = ?, email = ?,
            stage = ?, owner = ?, skills = ?, experience = ?, note = ?, applied_date = ?
        WHERE id = ?
      `).run(
        String(next.name).trim(),
        String(next.position).trim(),
        String(next.education).trim(),
        String(next.school).trim(),
        String(next.phone).trim(),
        String(next.email).trim(),
        next.stage,
        String(next.owner).trim(),
        String(next.skills || ''),
        String(next.experience || ''),
        String(next.note || ''),
        String(next.appliedDate),
        id
      )

      db.prepare(`
        UPDATE interviews
        SET candidate_name = ?, position = ?
        WHERE candidate_id = ?
      `).run(String(next.name).trim(), String(next.position).trim(), id)

      if (current.position !== next.position) {
        adjustPositionCount(current.position, -1)
        adjustPositionCount(String(next.position).trim(), 1)
      }
    })

    updateCandidate()
    res.json(getCandidate(id))
  })
)

router.delete('/:id', (req, res) => {
  const id = parseId(req.params.id)
  const current = getCandidate(id)
  if (!current) return res.status(404).json({ message: '候选人不存在' })

  const removeCandidate = db.transaction(() => {
    db.prepare('DELETE FROM candidates WHERE id = ?').run(id)
    adjustPositionCount(current.position, -1)
  })

  removeCandidate()
  res.status(204).end()
})

export default router
