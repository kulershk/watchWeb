import { Router, Response } from 'express'
import { join } from 'path'
import { existsSync, unlinkSync } from 'fs'
import { pool } from '../db.js'
import { uploadsDir } from '../config.js'
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth.js'
import { generateToken } from '../utils/generators.js'

const router = Router()

// GET /api/packs — list user's packs
router.get('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT p.token, p.name, p.is_public, p.tags, p.question_lang, p.answer_lang, p.download_count, p.created_at, p.updated_at, COUNT(w.id)::int AS word_count,
        CASE WHEN p.user_id = $1 THEN true ELSE false END AS is_owner
      FROM packs p
      LEFT JOIN words w ON w.pack_id = p.id
      LEFT JOIN pack_collaborators pc ON pc.pack_id = p.id
      WHERE p.user_id = $1 OR pc.user_id = $1
      GROUP BY p.id
      ORDER BY p.updated_at DESC
    `, [req.user!.userId])
    res.json(result.rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/packs/browse — browse public packs
router.get('/browse', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { tag, search } = req.query
    let query = `
      SELECT p.token, p.name, p.tags, p.question_lang, p.answer_lang, p.download_count, p.updated_at, u.display_name AS author, COUNT(w.id)::int AS word_count,
        COALESCE(AVG(pr.rating), 0) AS avg_rating, COUNT(DISTINCT pr.id)::int AS rating_count
      FROM packs p
      LEFT JOIN words w ON w.pack_id = p.id
      LEFT JOIN users u ON u.id = p.user_id
      LEFT JOIN pack_ratings pr ON pr.pack_id = p.id
      WHERE p.is_public = true
    `
    const params: any[] = []

    if (tag) {
      params.push(`%${tag}%`)
      query += ` AND LOWER(p.tags) LIKE LOWER($${params.length})`
    }
    if (search) {
      params.push(`%${search}%`)
      query += ` AND LOWER(p.name) LIKE LOWER($${params.length})`
    }
    if (req.query.question_lang) {
      params.push(req.query.question_lang)
      query += ` AND LOWER(p.question_lang) = LOWER($${params.length})`
    }
    if (req.query.answer_lang) {
      params.push(req.query.answer_lang)
      query += ` AND LOWER(p.answer_lang) = LOWER($${params.length})`
    }

    query += ` GROUP BY p.id, u.display_name ORDER BY COALESCE(AVG(pr.rating), 0) DESC, p.updated_at DESC LIMIT 50`

    const result = await pool.query(query, params)
    res.json(result.rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/packs/:token/edit — all words including disabled
router.get('/:token/edit', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { token } = req.params
    const pack = await pool.query('SELECT id, name, is_public, tags, question_lang, answer_lang, updated_at, user_id FROM packs WHERE token = $1', [token])
    if (pack.rows.length === 0) return res.status(404).json({ error: 'Pack not found' })
    if (pack.rows[0].user_id && pack.rows[0].user_id !== req.user!.userId) {
      const collab = await pool.query('SELECT 1 FROM pack_collaborators pc JOIN packs p ON p.id = pc.pack_id WHERE p.token = $1 AND pc.user_id = $2', [token, req.user!.userId])
      if (collab.rows.length === 0) return res.status(403).json({ error: 'Not your pack' })
    }

    const words = await pool.query(
      'SELECT question, answer, reading, enabled, audio, image FROM words WHERE pack_id = $1 ORDER BY id',
      [pack.rows[0].id]
    )
    res.json({ name: pack.rows[0].name, is_public: pack.rows[0].is_public, tags: pack.rows[0].tags || '', question_lang: pack.rows[0].question_lang || '', answer_lang: pack.rows[0].answer_lang || '', updated_at: pack.rows[0].updated_at, words: words.rows })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/packs — create a new word pack
router.post('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const client = await pool.connect()
  try {
    const { name, words, token: customToken, is_public, tags, question_lang, answer_lang } = req.body
    if (!words || !Array.isArray(words) || words.length === 0) {
      return res.status(400).json({ error: 'Words array is required' })
    }

    let token
    if (customToken) {
      if (!/^\d{4}$/.test(customToken)) {
        return res.status(400).json({ error: 'Code must be exactly 4 digits' })
      }
      const existing = await pool.query('SELECT 1 FROM packs WHERE token = $1', [customToken])
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'That code is already in use' })
      }
      token = customToken
    } else {
      token = await generateToken()
    }
    await client.query('BEGIN')
    const pack = await client.query(
      'INSERT INTO packs (token, name, user_id, is_public, tags, question_lang, answer_lang) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
      [token, name || '', req.user!.userId, is_public || false, tags || '', question_lang || '', answer_lang || '']
    )
    const packId = pack.rows[0].id

    for (const word of words) {
      await client.query(
        'INSERT INTO words (pack_id, question, answer, reading, enabled, audio, image) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [packId, word.question, word.answer, word.reading || '', word.enabled !== false, word.audio || '', word.image || '']
      )
    }

    await client.query('COMMIT')
    res.json({ token })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  } finally {
    client.release()
  }
})

// PUT /api/packs/:token — update a word pack
router.put('/:token', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const client = await pool.connect()
  try {
    const { token } = req.params
    const { name, words, is_public, tags, question_lang, answer_lang } = req.body
    if (!words || !Array.isArray(words) || words.length === 0) {
      return res.status(400).json({ error: 'Words array is required' })
    }

    const pack = await client.query('SELECT id, user_id FROM packs WHERE token = $1', [token])
    if (pack.rows.length === 0) return res.status(404).json({ error: 'Pack not found' })
    if (pack.rows[0].user_id && pack.rows[0].user_id !== req.user!.userId) {
      const collab = await client.query('SELECT 1 FROM pack_collaborators pc JOIN packs p ON p.id = pc.pack_id WHERE p.token = $1 AND pc.user_id = $2', [token, req.user!.userId])
      if (collab.rows.length === 0) return res.status(403).json({ error: 'Not your pack' })
    }

    const packId = pack.rows[0].id
    await client.query('BEGIN')
    await client.query('UPDATE packs SET name = $1, is_public = $2, tags = $3, question_lang = $4, answer_lang = $5, updated_at = NOW() WHERE id = $6', [name || '', is_public || false, tags || '', question_lang || '', answer_lang || '', packId])

    // Find old audio/image files to clean up
    const oldWords = await client.query('SELECT audio, image FROM words WHERE pack_id = $1', [packId])
    const newAudioFiles = new Set(words.map((w: any) => w.audio).filter(Boolean))
    const newImageFiles = new Set(words.map((w: any) => w.image).filter(Boolean))
    for (const oldWord of oldWords.rows) {
      if (oldWord.audio && !newAudioFiles.has(oldWord.audio)) {
        const filePath = join(uploadsDir, oldWord.audio)
        if (existsSync(filePath)) unlinkSync(filePath)
      }
      if (oldWord.image && !newImageFiles.has(oldWord.image)) {
        const filePath = join(uploadsDir, oldWord.image)
        if (existsSync(filePath)) unlinkSync(filePath)
      }
    }

    await client.query('DELETE FROM words WHERE pack_id = $1', [packId])

    for (const word of words) {
      await client.query(
        'INSERT INTO words (pack_id, question, answer, reading, enabled, audio, image) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [packId, word.question, word.answer, word.reading || '', word.enabled !== false, word.audio || '', word.image || '']
      )
    }

    await client.query('COMMIT')
    res.json({ ok: true })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  } finally {
    client.release()
  }
})

// DELETE /api/packs/:token
router.delete('/:token', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { token } = req.params
    const pack = await pool.query('SELECT id, user_id FROM packs WHERE token = $1', [token])
    if (pack.rows.length === 0) return res.status(404).json({ error: 'Pack not found' })
    if (pack.rows[0].user_id && pack.rows[0].user_id !== req.user!.userId) {
      return res.status(403).json({ error: 'Not your pack' })
    }

    // Delete audio and image files
    const words = await pool.query('SELECT audio, image FROM words WHERE pack_id = $1', [pack.rows[0].id])
    for (const word of words.rows) {
      if (word.audio) {
        const filePath = join(uploadsDir, word.audio)
        if (existsSync(filePath)) unlinkSync(filePath)
      }
      if (word.image) {
        const filePath = join(uploadsDir, word.image)
        if (existsSync(filePath)) unlinkSync(filePath)
      }
    }

    await pool.query('DELETE FROM packs WHERE token = $1', [token])
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

export default router
