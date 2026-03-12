import { Router, Response } from 'express'
import crypto from 'crypto'
import { join } from 'path'
import { existsSync, writeFileSync, unlinkSync } from 'fs'
import { uploadsDir } from '../config.js'
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth.js'

const router = Router()

// POST /api/audio — upload audio, returns filename
router.post('/', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data } = req.body
    if (!data) return res.status(400).json({ error: 'No audio data' })
    const match = data.match(/^data:(audio\/[^;]+)[^,]*;base64,(.+)$/)
    if (!match) return res.status(400).json({ error: 'Invalid audio format' })
    const mime = match[1]
    const ext = mime.includes('webm') ? 'webm' : mime.includes('mp4') ? 'mp4' : mime.includes('ogg') ? 'ogg' : 'wav'
    const buffer = Buffer.from(match[2], 'base64')
    const filename = crypto.randomUUID() + '.' + ext
    writeFileSync(join(uploadsDir, filename), buffer)
    res.json({ filename })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Upload failed' })
  }
})

// GET /api/audio/:filename — serve audio file (public for watch app)
router.get('/:filename', (req: AuthenticatedRequest, res: Response) => {
  const filePath = join(uploadsDir, req.params.filename)
  if (!existsSync(filePath)) return res.status(404).json({ error: 'Not found' })
  res.sendFile(filePath)
})

// DELETE /api/audio/:filename — delete audio file
router.delete('/:filename', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  const filePath = join(uploadsDir, req.params.filename)
  if (existsSync(filePath)) unlinkSync(filePath)
  res.json({ ok: true })
})

export default router
