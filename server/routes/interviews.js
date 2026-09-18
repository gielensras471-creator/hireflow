import { Router } from 'express'
import { db } from '../db/database.js'
import { asyncHandler, parseId, requireFields } from '../utils/http.js'

const router = Router()
const validStatuses = ['scheduled', 'completed', 'cancelled']

const selectSql = `
  SELECT
    id,
    candidate_id AS candidateId,
    candidate_name AS candidateName,
    position,
    date,
    time,
    interviewer,
    type,
    note,
    status
  FROM interviews
`

const getInterview = (id) => db.prepare(`${selectSql} WHERE id = ?`).get(id)

router.get('/', (_req, res) => {
  res.json(db.prepare(`${selectSql} ORDER BY date DESC, time DESC, id DESC`).all())
})

router.get('/:id', (req, res) => {
  const row = getInterview(parseId(req.params.id))
  if (!row) return res.status(404).json({ message: '面试记录不存在' })
  res.json(row)
})

router.post(
  '/',
  asyncHandler(async (req, res) => {
    requireFields(req.body, [
      'candidateId',
      'candidateName',
      'position',
      'date',
      'time',
      'interviewer',
      'type',
      'status'
    ])

    if (!validStatuses.includes(req.body.status)) {
      return res.status(400).json({ message: '面试状态无效' })
    }

    const candidateId = Number(req.body.candidateId)
    const candidate = db.prepare('SELECT id FROM candidates WHERE id = ?').get(candidateId)
    if (!candidate) return res.status(400).json({ message: '关联候选人不存在' })

    if (req.body.status === 'scheduled') {
      const existing = db
        .prepare("SELECT id FROM interviews WHERE candidate_id = ? AND status = 'scheduled' LIMIT 1")
        .get(candidateId)
      if (existing) return res.status(409).json({ message: '该候选人已有待进行面试' })
    }

    const result = db.prepare(`
      INSERT INTO interviews (
        candidate_id, candidate_name, position, date, time, interviewer, type, note, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      candidateId,
      String(req.body.candidateName).trim(),
      String(req.body.position).trim(),
      String(req.body.date),
      String(req.body.time),
      String(req.body.interviewer).trim(),
      String(req.body.type).trim(),
      String(req.body.note || ''),
      req.body.status
    )

    res.status(201).json(getInterview(Number(result.lastInsertRowid)))
  })
)

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id)
    const current = getInterview(id)
    if (!current) return res.status(404).json({ message: '面试记录不存在' })

    const next = { ...current, ...req.body }
    if (!validStatuses.includes(next.status)) {
      return res.status(400).json({ message: '面试状态无效' })
    }

    const candidate = db.prepare('SELECT id FROM candidates WHERE id = ?').get(Number(next.candidateId))
    if (!candidate) return res.status(400).json({ message: '关联候选人不存在' })

    if (next.status === 'scheduled') {
      const existing = db
        .prepare("SELECT id FROM interviews WHERE candidate_id = ? AND status = 'scheduled' AND id <> ? LIMIT 1")
        .get(Number(next.candidateId), id)
      if (existing) return res.status(409).json({ message: '该候选人已有待进行面试' })
    }

    db.prepare(`
      UPDATE interviews
      SET candidate_id = ?, candidate_name = ?, position = ?, date = ?, time = ?,
          interviewer = ?, type = ?, note = ?, status = ?
      WHERE id = ?
    `).run(
      Number(next.candidateId),
      String(next.candidateName).trim(),
      String(next.position).trim(),
      String(next.date),
      String(next.time),
      String(next.interviewer).trim(),
      String(next.type).trim(),
      String(next.note || ''),
      next.status,
      id
    )

    res.json(getInterview(id))
  })
)

router.delete('/:id', (req, res) => {
  const id = parseId(req.params.id)
  const result = db.prepare('DELETE FROM interviews WHERE id = ?').run(id)
  if (result.changes === 0) return res.status(404).json({ message: '面试记录不存在' })
  res.status(204).end()
})

export default router
