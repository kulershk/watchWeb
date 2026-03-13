import { Router, Response } from 'express'
import { join } from 'path'
import { existsSync, unlinkSync } from 'fs'
import { pool } from '../db.js'
import { uploadsDir } from '../config.js'
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth.js'
import { generateShareCode } from '../utils/generators.js'
import { optionalAuth } from '../middleware/auth.js'

const router = Router()

// GET /api/packs — list user's packs
router.get('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT p.id, p.name, p.is_public, p.tags, p.question_lang, p.answer_lang, p.download_count, p.verification_status, p.created_at, p.updated_at, COUNT(w.id)::int AS word_count,
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
    const verifiedOnly = req.query.verified_only !== 'false'
    let query = `
      SELECT p.id, p.name, p.tags, p.question_lang, p.answer_lang, p.download_count, p.verification_status, p.updated_at, u.display_name AS author, COUNT(w.id)::int AS word_count,
        COALESCE(AVG(pr.rating), 0) AS avg_rating, COUNT(DISTINCT pr.id)::int AS rating_count
      FROM packs p
      LEFT JOIN words w ON w.pack_id = p.id
      LEFT JOIN users u ON u.id = p.user_id
      LEFT JOIN pack_ratings pr ON pr.pack_id = p.id
      WHERE p.is_public = true AND p.verification_status != 'denied'
    `
    const params: any[] = []

    if (verifiedOnly) {
      query += ` AND p.verification_status = 'accepted'`
    }

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

// GET /api/packs/admin/pending — admin: list packs by verification status
router.get('/admin/pending', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = await pool.query('SELECT is_admin FROM users WHERE id = $1', [req.user!.userId])
    if (!user.rows[0]?.is_admin) return res.status(403).json({ error: 'Admin access required' })

    const statusFilter = (req.query.status as string) || 'pending'
    const validStatuses = ['none', 'pending', 'accepted', 'denied', 'neutral']
    if (!validStatuses.includes(statusFilter) && statusFilter !== 'all') {
      return res.status(400).json({ error: 'Invalid status filter' })
    }

    let query = `
      SELECT p.id, p.name, p.is_public, p.verification_status, p.tags, p.question_lang, p.answer_lang, p.download_count, p.updated_at,
        u.display_name AS author, COUNT(w.id)::int AS word_count
      FROM packs p
      LEFT JOIN words w ON w.pack_id = p.id
      LEFT JOIN users u ON u.id = p.user_id
      WHERE p.is_public = true
    `
    const params: any[] = []
    if (statusFilter !== 'all') {
      params.push(statusFilter)
      query += ` AND p.verification_status = $${params.length}`
    }
    query += ` GROUP BY p.id, u.display_name ORDER BY p.updated_at DESC`

    const result = await pool.query(query, params)
    res.json(result.rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/packs/:id/edit — all words including disabled
router.get('/:id/edit', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params
    const pack = await pool.query('SELECT id, name, is_public, verification_status, tags, question_lang, answer_lang, updated_at, user_id FROM packs WHERE id = $1', [id])
    if (pack.rows.length === 0) return res.status(404).json({ error: 'Pack not found' })
    if (pack.rows[0].user_id && pack.rows[0].user_id !== req.user!.userId) {
      const adminCheck = await pool.query('SELECT is_admin FROM users WHERE id = $1', [req.user!.userId])
      if (!adminCheck.rows[0]?.is_admin) {
        const collab = await pool.query('SELECT 1 FROM pack_collaborators pc WHERE pc.pack_id = $1 AND pc.user_id = $2', [id, req.user!.userId])
        if (collab.rows.length === 0) return res.status(403).json({ error: 'Not your pack' })
      }
    }

    const words = await pool.query(
      'SELECT question, answer, reading, enabled, audio, image FROM words WHERE pack_id = $1 ORDER BY id',
      [pack.rows[0].id]
    )
    res.json({ name: pack.rows[0].name, is_public: pack.rows[0].is_public, verification_status: pack.rows[0].verification_status || 'none', tags: pack.rows[0].tags || '', question_lang: pack.rows[0].question_lang || '', answer_lang: pack.rows[0].answer_lang || '', updated_at: pack.rows[0].updated_at, words: words.rows })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/packs — create a new word pack
router.post('/', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const client = await pool.connect()
  try {
    const { name, words, is_public, tags, question_lang, answer_lang } = req.body
    if (!words || !Array.isArray(words) || words.length === 0) {
      return res.status(400).json({ error: 'Words array is required' })
    }

    await client.query('BEGIN')
    const verificationStatus = is_public ? 'pending' : 'none'
    const pack = await client.query(
      'INSERT INTO packs (name, user_id, is_public, tags, question_lang, answer_lang, verification_status) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
      [name || '', req.user!.userId, is_public || false, tags || '', question_lang || '', answer_lang || '', verificationStatus]
    )
    const packId = pack.rows[0].id

    for (const word of words) {
      await client.query(
        'INSERT INTO words (pack_id, question, answer, reading, enabled, audio, image) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [packId, word.question, word.answer, word.reading || '', word.enabled !== false, word.audio || '', word.image || '']
      )
    }

    await client.query('COMMIT')
    res.json({ id: packId })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  } finally {
    client.release()
  }
})

// PUT /api/packs/:id — update a word pack
router.put('/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const client = await pool.connect()
  try {
    const { id } = req.params
    const { name, words, is_public, tags, question_lang, answer_lang } = req.body
    if (!words || !Array.isArray(words) || words.length === 0) {
      return res.status(400).json({ error: 'Words array is required' })
    }

    const pack = await client.query('SELECT id, user_id, is_public, verification_status FROM packs WHERE id = $1', [id])
    if (pack.rows.length === 0) return res.status(404).json({ error: 'Pack not found' })
    if (pack.rows[0].user_id && pack.rows[0].user_id !== req.user!.userId) {
      const adminCheck = await client.query('SELECT is_admin FROM users WHERE id = $1', [req.user!.userId])
      if (!adminCheck.rows[0]?.is_admin) {
        const collab = await client.query('SELECT 1 FROM pack_collaborators pc WHERE pc.pack_id = $1 AND pc.user_id = $2', [id, req.user!.userId])
        if (collab.rows.length === 0) return res.status(403).json({ error: 'Not your pack' })
      }
    }

    const packId = pack.rows[0].id
    const wasPublic = pack.rows[0].is_public
    const newIsPublic = is_public || false

    // Determine verification_status
    let verificationStatus = pack.rows[0].verification_status || 'none'
    if (newIsPublic && !wasPublic) {
      // Going from private to public
      verificationStatus = 'pending'
    } else if (newIsPublic && wasPublic) {
      // Already public, any edit resets to pending
      verificationStatus = 'pending'
    } else if (!newIsPublic) {
      verificationStatus = 'none'
    }

    await client.query('BEGIN')
    await client.query('UPDATE packs SET name = $1, is_public = $2, tags = $3, question_lang = $4, answer_lang = $5, verification_status = $6, updated_at = NOW() WHERE id = $7', [name || '', newIsPublic, tags || '', question_lang || '', answer_lang || '', verificationStatus, packId])

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

// DELETE /api/packs/:id
router.delete('/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params
    const pack = await pool.query('SELECT id, user_id FROM packs WHERE id = $1', [id])
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

    await pool.query('DELETE FROM packs WHERE id = $1', [id])
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/packs/:id/share — generate a share code for a pack
router.post('/:id/share', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params
    const pack = await pool.query(
      `SELECT p.id FROM packs p LEFT JOIN pack_collaborators pc ON pc.pack_id = p.id
       WHERE p.id = $1 AND (p.user_id = $2 OR pc.user_id = $2)`,
      [id, req.user!.userId]
    )
    if (pack.rows.length === 0) return res.status(403).json({ error: 'Not your pack' })

    const code = await generateShareCode()
    await pool.query(
      'INSERT INTO pack_share_codes (pack_id, code, created_by) VALUES ($1, $2, $3)',
      [pack.rows[0].id, code, req.user!.userId]
    )
    res.json({ code })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/packs/share/:code — redeem a share code and get the pack data
router.get('/share/:code', optionalAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { code } = req.params
    const result = await pool.query(
      `SELECT p.id, p.name, p.updated_at, p.question_lang, p.answer_lang, p.download_count,
              u.display_name AS author, sc.expires_at
       FROM pack_share_codes sc
       JOIN packs p ON p.id = sc.pack_id
       LEFT JOIN users u ON u.id = p.user_id
       WHERE sc.code = $1`,
      [code]
    )
    if (result.rows.length === 0) return res.status(404).json({ error: 'Invalid share code' })

    const row = result.rows[0]
    if (new Date(row.expires_at) < new Date()) return res.status(410).json({ error: 'Share code expired' })

    const words = await pool.query(
      'SELECT question, answer, reading, audio, image FROM words WHERE pack_id = $1 AND enabled = true ORDER BY id',
      [row.id]
    )

    res.json({
      id: row.id,
      name: row.name,
      updated_at: row.updated_at,
      question_lang: row.question_lang || '',
      answer_lang: row.answer_lang || '',
      author: row.author || '',
      download_count: row.download_count || 0,
      words: words.rows
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// PUT /api/packs/:id/verify — admin-only: set verification status
router.put('/:id/verify', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = await pool.query('SELECT is_admin FROM users WHERE id = $1', [req.user!.userId])
    if (!user.rows[0]?.is_admin) return res.status(403).json({ error: 'Admin access required' })

    const { status } = req.body
    const validStatuses = ['none', 'pending', 'accepted', 'denied', 'neutral']
    if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' })

    const { id } = req.params
    await pool.query('UPDATE packs SET verification_status = $1 WHERE id = $2', [status, id])
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

export default router
