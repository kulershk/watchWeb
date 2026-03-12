import { Router, Response } from 'express'
import { pool } from '../db.js'
import { authenticateToken, optionalAuth, AuthenticatedRequest } from '../middleware/auth.js'

const router = Router()

// POST /api/packs/:token/rate — rate a pack (1-5 stars)
router.post('/:token/rate', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { token } = req.params
    const { rating } = req.body
    if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating must be 1-5' })

    const pack = await pool.query('SELECT id FROM packs WHERE token = $1', [token])
    if (pack.rows.length === 0) return res.status(404).json({ error: 'Pack not found' })

    await pool.query(`
      INSERT INTO pack_ratings (pack_id, user_id, rating) VALUES ($1, $2, $3)
      ON CONFLICT (pack_id, user_id) DO UPDATE SET rating = $3
    `, [pack.rows[0].id, req.user!.userId, rating])

    const stats = await pool.query(
      'SELECT COALESCE(AVG(rating), 0) AS avg_rating, COUNT(*)::int AS rating_count FROM pack_ratings WHERE pack_id = $1',
      [pack.rows[0].id]
    )
    res.json({ avg_rating: parseFloat(stats.rows[0].avg_rating), rating_count: stats.rows[0].rating_count, user_rating: rating })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/packs/:token/rating — get rating info (optional auth to include user's rating)
router.get('/:token/rating', optionalAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { token } = req.params
    const pack = await pool.query('SELECT id FROM packs WHERE token = $1', [token])
    if (pack.rows.length === 0) return res.status(404).json({ error: 'Pack not found' })

    const stats = await pool.query(
      'SELECT COALESCE(AVG(rating), 0) AS avg_rating, COUNT(*)::int AS rating_count FROM pack_ratings WHERE pack_id = $1',
      [pack.rows[0].id]
    )

    let userRating = 0
    if (req.user) {
      const ur = await pool.query('SELECT rating FROM pack_ratings WHERE pack_id = $1 AND user_id = $2', [pack.rows[0].id, req.user.userId])
      if (ur.rows.length > 0) userRating = ur.rows[0].rating
    }

    res.json({ avg_rating: parseFloat(stats.rows[0].avg_rating), rating_count: stats.rows[0].rating_count, user_rating: userRating })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

export default router
