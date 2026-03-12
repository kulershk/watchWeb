import { Router, Response } from 'express'
import crypto from 'crypto'
import { join } from 'path'
import { existsSync, writeFileSync, unlinkSync } from 'fs'
import { uploadsDir } from '../config.js'
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth.js'

const router = Router()

const MAX_IMAGE_SIZE = 5 * 1024 * 1024 // 5MB
const MAX_DIMENSION = 800 // resize if wider or taller

// POST /api/images — upload image, resize if large, returns filename
router.post('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data } = req.body
    if (!data) return res.status(400).json({ error: 'No image data' })
    const match = data.match(/^data:(image\/[^;]+)[^,]*;base64,(.+)$/)
    if (!match) return res.status(400).json({ error: 'Invalid image format' })
    const mime = match[1]
    const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : mime.includes('gif') ? 'gif' : 'jpg'
    let buffer = Buffer.from(match[2], 'base64')

    if (buffer.length > MAX_IMAGE_SIZE) {
      return res.status(400).json({ error: 'Image too large (max 5MB)' })
    }

    // Resize using sharp if available
    try {
      const sharp = (await import('sharp')).default
      const metadata = await sharp(buffer).metadata()
      const width = metadata.width || 0
      const height = metadata.height || 0

      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        buffer = await sharp(buffer)
          .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer()
      }
    } catch {
      // sharp not available, store as-is
    }

    const filename = crypto.randomUUID() + '.' + ext
    writeFileSync(join(uploadsDir, filename), buffer)
    res.json({ filename })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Upload failed' })
  }
})

// GET /api/images/:filename — serve image file (public)
router.get('/:filename', (req: AuthenticatedRequest, res: Response) => {
  const filePath = join(uploadsDir, req.params.filename)
  if (!existsSync(filePath)) return res.status(404).json({ error: 'Not found' })
  res.sendFile(filePath)
})

// DELETE /api/images/:filename — delete image file
router.delete('/:filename', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  const filePath = join(uploadsDir, req.params.filename)
  if (existsSync(filePath)) unlinkSync(filePath)
  res.json({ ok: true })
})

export default router
