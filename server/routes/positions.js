import { Router } from 'express'
import { db } from '../db/database.js'
import { asyncHandler, parseId, requireFields } from '../utils/http.js'

const router = Router()

const selectById = db.prepare(`
  SELECT
    id,
    title,
    department,
    location,
    status,
    candidate_count AS candidateCount,
    publish_date AS publishDate,
    description
  FROM positions
  WHERE id = ?
`)

const getPosition = (id) => selectById.get(id)

router.get('/', (_req, res) => {
  const rows = db.prepare(`
    SELECT
      id,
      title,
      department,
      location,
      status,
      candidate_count AS candidateCount,
      publish_date AS publishDate,
      description
    FROM positions
    ORDER BY publish_date DESC, id DESC
  `).all()

  res.json(rows)
})

router.get('/:id', (req, res) => {
  const row = getPosition(parseId(req.params.id))
  if (!row) return res.status(404).json({ message: '职位不存在' })
  res.json(row)
})

router.post(
  '/',
  asyncHandler(async (req, res) => {
    requireFields(req.body, ['title', 'department', 'location', 'status', 'publishDate', 'description'])

    if (!['open', 'closed'].includes(req.body.status)) {
      return res.status(400).json({ message: '职位状态无效' })
    }

    const result = db.prepare(`
      INSERT INTO positions (
        title, department, location, status, candidate_count, publish_date, description
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      String(req.body.title).trim(),
      String(req.body.department).trim(),
      String(req.body.location).trim(),
      req.body.status,
      Number(req.body.candidateCount) || 0,
      String(req.body.publishDate),
      String(req.body.description).trim()
    )

    res.status(201).json(getPosition(Number(result.lastInsertRowid)))
  })
)

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id)
    const current = getPosition(id)
    if (!current) return res.status(404).json({ message: '职位不存在' })

    const next = {
      ...current,
      ...req.body
    }

    if (!['open', 'closed'].includes(next.status)) {
      return res.status(400).json({ message: '职位状态无效' })
    }

    const updatePosition = db.transaction(() => {
      db.prepare(`
        UPDATE positions
        SET title = ?, department = ?, location = ?, status = ?, candidate_count = ?, publish_date = ?, description = ?
        WHERE id = ?
      `).run(
        String(next.title).trim(),
        String(next.department).trim(),
        String(next.location).trim(),
        next.status,
        Number(next.candidateCount) || 0,
        String(next.publishDate),
        String(next.description).trim(),
        id
      )

      if (current.title !== next.title) {
        db.prepare('UPDATE candidates SET position = ? WHERE position = ?').run(
          String(next.title).trim(),
          current.title
        )
        db.prepare('UPDATE interviews SET position = ? WHERE position = ?').run(
          String(next.title).trim(),
          current.title
        )
      }
    })

    updatePosition()
    res.json(getPosition(id))
  })
)

router.delete('/:id', (req, res) => {
  const id = parseId(req.params.id)
  const result = db.prepare('DELETE FROM positions WHERE id = ?').run(id)
  if (result.changes === 0) return res.status(404).json({ message: '职位不存在' })
  res.status(204).end()
})

export default router
