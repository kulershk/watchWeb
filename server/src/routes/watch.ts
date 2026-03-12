import { Router, Response } from 'express'
import crypto from 'crypto'
import { pool } from '../db.js'
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth.js'

const router = Router()

// Store pairing codes in memory (they expire quickly)
const pairingCodes = new Map<string, { userId: number; syncToken: string; expiresAt: number }>()

// POST /api/watch/pair-code — phone requests a temporary pairing code
router.post('/pair-code', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Generate a sync token (permanent) for this user if not already stored
    let result = await pool.query('SELECT sync_token FROM users WHERE id = $1', [req.user!.userId])
    let syncToken = result.rows[0]?.sync_token

    if (!syncToken) {
      syncToken = crypto.randomUUID()
      await pool.query('UPDATE users SET sync_token = $1 WHERE id = $2', [syncToken, req.user!.userId])
    }

    // Generate temporary 6-digit code
    let code: string = ''
    for (let i = 0; i < 100; i++) {
      code = String(Math.floor(Math.random() * 1000000)).padStart(6, '0')
      if (!pairingCodes.has(code)) break
    }

    pairingCodes.set(code, {
      userId: req.user!.userId,
      syncToken,
      expiresAt: Date.now() + 5 * 60 * 1000 // 5 minutes
    })

    // Clean up expired codes
    for (const [k, v] of pairingCodes) {
      if (v.expiresAt < Date.now()) pairingCodes.delete(k)
    }

    res.json({ code, expiresIn: 300 })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/watch/pair — watch submits pairing code, gets permanent sync token
router.post('/pair', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { code } = req.body
    if (!code) return res.status(400).json({ error: 'Code required' })

    const pairing = pairingCodes.get(code)
    if (!pairing) return res.status(404).json({ error: 'Invalid code' })
    if (pairing.expiresAt < Date.now()) {
      pairingCodes.delete(code)
      return res.status(410).json({ error: 'Code expired' })
    }

    pairingCodes.delete(code)
    res.json({ syncToken: pairing.syncToken })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// PUT /api/watch/sync-packs — phone pushes its enabled pack tokens for watch sync
router.put('/sync-packs', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { tokens } = req.body
    if (!Array.isArray(tokens)) return res.status(400).json({ error: 'tokens must be an array' })

    const filtered = tokens.filter((t: any) => typeof t === 'string' && t.length > 0)
    await pool.query('UPDATE users SET watch_sync_packs = $1 WHERE id = $2', [JSON.stringify(filtered), req.user!.userId])

    res.json({ synced: filtered.length })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/watch/sync/:syncToken — watch fetches user's enabled packs
router.get('/sync/:syncToken', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { syncToken } = req.params
    const user = await pool.query('SELECT id, watch_sync_packs FROM users WHERE sync_token = $1', [syncToken])
    if (user.rows.length === 0) return res.status(401).json({ error: 'Invalid sync token' })

    const userId = user.rows[0].id
    let syncPackTokens: string[] = []
    try {
      syncPackTokens = JSON.parse(user.rows[0].watch_sync_packs || '[]')
    } catch { syncPackTokens = [] }

    let packsResult
    if (syncPackTokens.length > 0) {
      // Sync only the packs the phone has enabled
      packsResult = await pool.query(`
        SELECT p.token, p.name, p.updated_at, p.question_lang, p.answer_lang
        FROM packs p
        WHERE p.token = ANY($1)
        ORDER BY p.updated_at DESC
      `, [syncPackTokens])
    } else {
      // Fallback: sync all user's own packs
      packsResult = await pool.query(`
        SELECT p.token, p.name, p.updated_at, p.question_lang, p.answer_lang
        FROM packs p
        WHERE p.user_id = $1
        ORDER BY p.updated_at DESC
      `, [userId])
    }

    const packs = []
    for (const pack of packsResult.rows) {
      const words = await pool.query(
        'SELECT question, answer, reading, audio, image FROM words WHERE pack_id = (SELECT id FROM packs WHERE token = $1) AND enabled = true ORDER BY id',
        [pack.token]
      )
      packs.push({
        token: pack.token,
        name: pack.name,
        updated_at: pack.updated_at,
        question_lang: pack.question_lang || '',
        answer_lang: pack.answer_lang || '',
        words: words.rows
      })
    }

    res.json({ packs })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

export default router
