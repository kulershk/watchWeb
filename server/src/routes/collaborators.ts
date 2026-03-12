import { Router, Response } from 'express'
import { pool } from '../db.js'
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth.js'

const router = Router()

// GET /api/users/lookup/:friendCode — look up user by friend code
router.get('/users/lookup/:friendCode', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT id, display_name, email FROM users WHERE friend_code = $1',
      [req.params.friendCode.toUpperCase()]
    )
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' })
    const user = result.rows[0]
    res.json({ id: user.id, displayName: user.display_name || user.email.split('@')[0] })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/packs/:token/collaborators — list collaborators for a pack (owner only)
router.get('/packs/:token/collaborators', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const pack = await pool.query('SELECT id, user_id FROM packs WHERE token = $1', [req.params.token])
    if (pack.rows.length === 0) return res.status(404).json({ error: 'Pack not found' })
    if (pack.rows[0].user_id !== req.user!.userId) return res.status(403).json({ error: 'Not your pack' })

    const result = await pool.query(`
      SELECT u.id, u.display_name, u.email, u.friend_code
      FROM pack_collaborators pc
      JOIN users u ON u.id = pc.user_id
      WHERE pc.pack_id = $1
      ORDER BY pc.added_at
    `, [pack.rows[0].id])

    res.json(result.rows.map(u => ({
      id: u.id,
      displayName: u.display_name || u.email.split('@')[0],
      friendCode: u.friend_code
    })))
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/packs/:token/collaborators — add collaborator by friend code (owner only)
router.post('/packs/:token/collaborators', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { friend_code } = req.body
    if (!friend_code) return res.status(400).json({ error: 'Friend code required' })

    const pack = await pool.query('SELECT id, user_id FROM packs WHERE token = $1', [req.params.token])
    if (pack.rows.length === 0) return res.status(404).json({ error: 'Pack not found' })
    if (pack.rows[0].user_id !== req.user!.userId) return res.status(403).json({ error: 'Not your pack' })

    const user = await pool.query('SELECT id FROM users WHERE friend_code = $1', [friend_code.toUpperCase()])
    if (user.rows.length === 0) return res.status(404).json({ error: 'User not found' })
    if (user.rows[0].id === req.user!.userId) return res.status(400).json({ error: 'Cannot add yourself' })

    await pool.query(
      'INSERT INTO pack_collaborators (pack_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [pack.rows[0].id, user.rows[0].id]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// DELETE /api/packs/:token/collaborators/:userId — remove collaborator (owner only)
router.delete('/packs/:token/collaborators/:userId', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const pack = await pool.query('SELECT id, user_id FROM packs WHERE token = $1', [req.params.token])
    if (pack.rows.length === 0) return res.status(404).json({ error: 'Pack not found' })
    if (pack.rows[0].user_id !== req.user!.userId) return res.status(403).json({ error: 'Not your pack' })

    await pool.query('DELETE FROM pack_collaborators WHERE pack_id = $1 AND user_id = $2', [pack.rows[0].id, parseInt(req.params.userId)])
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

export default router
