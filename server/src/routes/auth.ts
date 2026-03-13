import { Router, Response } from 'express'
import bcrypt from 'bcrypt'
import { pool } from '../db.js'
import { GOOGLE_CLIENT_ID, googleClient } from '../config.js'
import { authenticateToken, createToken, AuthenticatedRequest } from '../middleware/auth.js'
import { generateFriendCode } from '../utils/generators.js'

const router = Router()

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PASSWORD_MIN_LENGTH = 8

function validateEmail(email: string): string | null {
  if (!email || typeof email !== 'string') return 'Email is required'
  const trimmed = email.trim().toLowerCase()
  if (trimmed.length > 255) return 'Email must be 255 characters or less'
  if (!EMAIL_REGEX.test(trimmed)) return 'Invalid email format'
  return null
}

function validatePassword(password: string): string | null {
  if (!password || typeof password !== 'string') return 'Password is required'
  if (password.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`
  if (password.length > 128) return 'Password must be 128 characters or less'
  if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter'
  if (!/[a-z]/.test(password)) return 'Password must contain at least one lowercase letter'
  if (!/[0-9]/.test(password)) return 'Password must contain at least one number'
  return null
}

// POST /api/auth/register
router.post('/register', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { email, password, displayName } = req.body

    const emailError = validateEmail(email)
    if (emailError) return res.status(400).json({ error: emailError })

    const passwordError = validatePassword(password)
    if (passwordError) return res.status(400).json({ error: passwordError })

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()])
    if (existing.rows.length > 0) return res.status(409).json({ error: 'Email already registered' })

    const sanitizedEmail = email.trim().toLowerCase()
    const sanitizedDisplayName = (displayName || '').trim().slice(0, 100)

    const passwordHash = await bcrypt.hash(password, 12)
    const friendCode = await generateFriendCode()
    const result = await pool.query(
      'INSERT INTO users (email, password_hash, display_name, friend_code) VALUES ($1, $2, $3, $4) RETURNING id, email, display_name, friend_code',
      [sanitizedEmail, passwordHash, sanitizedDisplayName, friendCode]
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

    let isNewUser = false
    if (result.rows.length === 0) {
      // Check if user exists by email (registered with password)
      result = await pool.query('SELECT id, email, display_name, friend_code FROM users WHERE email = $1', [email!.toLowerCase()])
      if (result.rows.length > 0) {
        // Link Google ID to existing account
        await pool.query('UPDATE users SET google_id = $1 WHERE id = $2', [googleId, result.rows[0].id])
      } else {
        // Create new user
        isNewUser = true
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

    // Always update google_name from the latest Google token
    if (name) {
      await pool.query('UPDATE users SET google_name = $1 WHERE id = $2', [name, user.id])
    }

    const token = createToken(user)
    res.json({ token, isNewUser, user: { id: user.id, email: user.email, displayName: user.display_name, friendCode: user.friend_code } })
  } catch (err) {
    console.error(err)
    res.status(401).json({ error: 'Invalid Google token' })
  }
})

// GET /api/auth/me
router.get('/me', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await pool.query('SELECT id, email, display_name, friend_code, is_admin FROM users WHERE id = $1', [req.user!.userId])
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' })
    const user = result.rows[0]
    if (!user.friend_code) {
      const friendCode = await generateFriendCode()
      await pool.query('UPDATE users SET friend_code = $1 WHERE id = $2', [friendCode, user.id])
      user.friend_code = friendCode
    }
    res.json({ id: user.id, email: user.email, displayName: user.display_name, friendCode: user.friend_code, isAdmin: user.is_admin || false })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// PUT /api/auth/display-name
router.put('/display-name', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { displayName } = req.body
    if (typeof displayName !== 'string') return res.status(400).json({ error: 'Display name required' })
    const sanitized = displayName.trim().slice(0, 100)
    await pool.query('UPDATE users SET display_name = $1 WHERE id = $2', [sanitized, req.user!.userId])
    res.json({ displayName: sanitized })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

export default router
