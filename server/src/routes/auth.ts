import { Router, Response } from 'express'
import bcrypt from 'bcrypt'
import { pool } from '../db.js'
import { GOOGLE_CLIENT_ID, googleClient } from '../config.js'
import { authenticateToken, createToken, AuthenticatedRequest } from '../middleware/auth.js'
import { generateFriendCode } from '../utils/generators.js'

const router = Router()

// POST /api/auth/register
router.post('/register', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { email, password, displayName } = req.body
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' })
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' })

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()])
    if (existing.rows.length > 0) return res.status(409).json({ error: 'Email already registered' })

    const passwordHash = await bcrypt.hash(password, 12)
    const friendCode = await generateFriendCode()
    const result = await pool.query(
      'INSERT INTO users (email, password_hash, display_name, friend_code) VALUES ($1, $2, $3, $4) RETURNING id, email, display_name, friend_code',
      [email.toLowerCase(), passwordHash, displayName || '', friendCode]
    )
    const user = result.rows[0]
    const token = createToken(user)
    res.json({ token, user: { id: user.id, email: user.email, displayName: user.display_name, friendCode: user.friend_code } })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/auth/login
router.post('/login', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { email, password } = req.body
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' })

    const result = await pool.query('SELECT id, email, password_hash, display_name, friend_code FROM users WHERE email = $1', [email.toLowerCase()])
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid email or password' })

    const user = result.rows[0]
    if (!user.password_hash) return res.status(401).json({ error: 'This account uses Google Sign-In' })

    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' })

    if (!user.friend_code) {
      const friendCode = await generateFriendCode()
      await pool.query('UPDATE users SET friend_code = $1 WHERE id = $2', [friendCode, user.id])
      user.friend_code = friendCode
    }

    const token = createToken(user)
    res.json({ token, user: { id: user.id, email: user.email, displayName: user.display_name, friendCode: user.friend_code } })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/auth/google
router.post('/google', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { idToken } = req.body
    if (!idToken) return res.status(400).json({ error: 'ID token required' })
    if (!GOOGLE_CLIENT_ID) return res.status(500).json({ error: 'Google Sign-In not configured' })

    const ticket = await googleClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID })
    const payload = ticket.getPayload()!
    const { sub: googleId, email, name } = payload

    // Check if user exists by google_id
    let result = await pool.query('SELECT id, email, display_name, friend_code FROM users WHERE google_id = $1', [googleId])

    if (result.rows.length === 0) {
      // Check if user exists by email (registered with password)
      result = await pool.query('SELECT id, email, display_name, friend_code FROM users WHERE email = $1', [email!.toLowerCase()])
      if (result.rows.length > 0) {
        // Link Google ID to existing account
        await pool.query('UPDATE users SET google_id = $1 WHERE id = $2', [googleId, result.rows[0].id])
      } else {
        // Create new user
        const friendCode = await generateFriendCode()
        result = await pool.query(
          'INSERT INTO users (email, google_id, display_name, friend_code) VALUES ($1, $2, $3, $4) RETURNING id, email, display_name, friend_code',
          [email!.toLowerCase(), googleId, name || '', friendCode]
        )
      }
    }

    const user = result.rows[0]
    if (!user.friend_code) {
      const friendCode = await generateFriendCode()
      await pool.query('UPDATE users SET friend_code = $1 WHERE id = $2', [friendCode, user.id])
      user.friend_code = friendCode
    }

    const token = createToken(user)
    res.json({ token, user: { id: user.id, email: user.email, displayName: user.display_name, friendCode: user.friend_code } })
  } catch (err) {
    console.error(err)
    res.status(401).json({ error: 'Invalid Google token' })
  }
})

// GET /api/auth/me
router.get('/me', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await pool.query('SELECT id, email, display_name, friend_code FROM users WHERE id = $1', [req.user!.userId])
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' })
    const user = result.rows[0]
    if (!user.friend_code) {
      const friendCode = await generateFriendCode()
      await pool.query('UPDATE users SET friend_code = $1 WHERE id = $2', [friendCode, user.id])
      user.friend_code = friendCode
    }
    res.json({ id: user.id, email: user.email, displayName: user.display_name, friendCode: user.friend_code })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

export default router
