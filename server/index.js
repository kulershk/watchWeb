import express from 'express'
import cors from 'cors'
import pg from 'pg'
import crypto from 'crypto'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { OAuth2Client } from 'google-auth-library'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = 3001
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production'
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID)

app.use(cors())
app.use(express.json({ limit: '10mb' }))

const uploadsDir = join(__dirname, 'uploads')
if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true })

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://watch:watch@localhost:5432/watch',
})

// Init database
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255),
      google_id VARCHAR(255) UNIQUE,
      display_name TEXT DEFAULT '',
      sync_token VARCHAR(255) UNIQUE,
      friend_code VARCHAR(6) UNIQUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS packs (
      id SERIAL PRIMARY KEY,
      token VARCHAR(4) UNIQUE NOT NULL,
      name TEXT DEFAULT '',
      user_id INTEGER REFERENCES users(id),
      is_public BOOLEAN DEFAULT FALSE,
      tags TEXT DEFAULT '',
      question_lang TEXT DEFAULT '',
      answer_lang TEXT DEFAULT '',
      download_count INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS words (
      id SERIAL PRIMARY KEY,
      pack_id INTEGER REFERENCES packs(id) ON DELETE CASCADE,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      reading TEXT DEFAULT '',
      enabled BOOLEAN DEFAULT TRUE,
      audio VARCHAR(255) DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS pack_collaborators (
      id SERIAL PRIMARY KEY,
      pack_id INTEGER REFERENCES packs(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      added_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(pack_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS pack_downloads (
      id SERIAL PRIMARY KEY,
      pack_id INTEGER REFERENCES packs(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      downloaded_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(pack_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS pack_ratings (
      id SERIAL PRIMARY KEY,
      pack_id INTEGER REFERENCES packs(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(pack_id, user_id)
    );
  `)
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS sync_token VARCHAR(255) UNIQUE;
    ALTER TABLE packs ADD COLUMN IF NOT EXISTS name TEXT DEFAULT '';
    ALTER TABLE packs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
    ALTER TABLE packs ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id);
    ALTER TABLE packs ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT FALSE;
    ALTER TABLE packs ADD COLUMN IF NOT EXISTS tags TEXT DEFAULT '';
    ALTER TABLE packs ADD COLUMN IF NOT EXISTS question_lang TEXT DEFAULT '';
    ALTER TABLE packs ADD COLUMN IF NOT EXISTS answer_lang TEXT DEFAULT '';
    ALTER TABLE packs ADD COLUMN IF NOT EXISTS download_count INTEGER DEFAULT 0;
    ALTER TABLE words ADD COLUMN IF NOT EXISTS enabled BOOLEAN DEFAULT TRUE;
    ALTER TABLE words ADD COLUMN IF NOT EXISTS audio VARCHAR(255) DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS friend_code VARCHAR(6) UNIQUE;
  `).catch(() => {})
}

// JWT helpers
function createToken(user) {
  return jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' })
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]
  if (!token) return res.status(401).json({ error: 'Authentication required' })
  try {
    req.user = jwt.verify(token, JWT_SECRET)
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid token' })
  }
}

// Optional auth — sets req.user if token present, continues regardless
function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1]
  if (token) {
    try { req.user = jwt.verify(token, JWT_SECRET) } catch {}
  }
  next()
}

// Generate unique 4-digit token
async function generateToken() {
  for (let attempt = 0; attempt < 100; attempt++) {
    const token = String(Math.floor(Math.random() * 10000)).padStart(4, '0')
    const existing = await pool.query('SELECT 1 FROM packs WHERE token = $1', [token])
    if (existing.rows.length === 0) return token
  }
  throw new Error('Could not generate unique token')
}

// Generate unique 6-character friend code
async function generateFriendCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  for (let attempt = 0; attempt < 100; attempt++) {
    let code = ''
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)]
    const existing = await pool.query('SELECT 1 FROM users WHERE friend_code = $1', [code])
    if (existing.rows.length === 0) return code
  }
  throw new Error('Could not generate unique friend code')
}

// ============ AUTH ROUTES ============

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
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
app.post('/api/auth/login', async (req, res) => {
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
app.post('/api/auth/google', async (req, res) => {
  try {
    const { idToken } = req.body
    if (!idToken) return res.status(400).json({ error: 'ID token required' })
    if (!GOOGLE_CLIENT_ID) return res.status(500).json({ error: 'Google Sign-In not configured' })

    const ticket = await googleClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID })
    const payload = ticket.getPayload()
    const { sub: googleId, email, name } = payload

    // Check if user exists by google_id
    let result = await pool.query('SELECT id, email, display_name, friend_code FROM users WHERE google_id = $1', [googleId])

    if (result.rows.length === 0) {
      // Check if user exists by email (registered with password)
      result = await pool.query('SELECT id, email, display_name, friend_code FROM users WHERE email = $1', [email.toLowerCase()])
      if (result.rows.length > 0) {
        // Link Google ID to existing account
        await pool.query('UPDATE users SET google_id = $1 WHERE id = $2', [googleId, result.rows[0].id])
      } else {
        // Create new user
        const friendCode = await generateFriendCode()
        result = await pool.query(
          'INSERT INTO users (email, google_id, display_name, friend_code) VALUES ($1, $2, $3, $4) RETURNING id, email, display_name, friend_code',
          [email.toLowerCase(), googleId, name || '', friendCode]
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
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, email, display_name, friend_code FROM users WHERE id = $1', [req.user.userId])
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

// ============ FRIEND CODE / COLLABORATION ROUTES ============

// GET /api/users/lookup/:friendCode — look up user by friend code
app.get('/api/users/lookup/:friendCode', authenticateToken, async (req, res) => {
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
app.get('/api/packs/:token/collaborators', authenticateToken, async (req, res) => {
  try {
    const pack = await pool.query('SELECT id, user_id FROM packs WHERE token = $1', [req.params.token])
    if (pack.rows.length === 0) return res.status(404).json({ error: 'Pack not found' })
    if (pack.rows[0].user_id !== req.user.userId) return res.status(403).json({ error: 'Not your pack' })

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
app.post('/api/packs/:token/collaborators', authenticateToken, async (req, res) => {
  try {
    const { friend_code } = req.body
    if (!friend_code) return res.status(400).json({ error: 'Friend code required' })

    const pack = await pool.query('SELECT id, user_id FROM packs WHERE token = $1', [req.params.token])
    if (pack.rows.length === 0) return res.status(404).json({ error: 'Pack not found' })
    if (pack.rows[0].user_id !== req.user.userId) return res.status(403).json({ error: 'Not your pack' })

    const user = await pool.query('SELECT id FROM users WHERE friend_code = $1', [friend_code.toUpperCase()])
    if (user.rows.length === 0) return res.status(404).json({ error: 'User not found' })
    if (user.rows[0].id === req.user.userId) return res.status(400).json({ error: 'Cannot add yourself' })

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
app.delete('/api/packs/:token/collaborators/:userId', authenticateToken, async (req, res) => {
  try {
    const pack = await pool.query('SELECT id, user_id FROM packs WHERE token = $1', [req.params.token])
    if (pack.rows.length === 0) return res.status(404).json({ error: 'Pack not found' })
    if (pack.rows[0].user_id !== req.user.userId) return res.status(403).json({ error: 'Not your pack' })

    await pool.query('DELETE FROM pack_collaborators WHERE pack_id = $1 AND user_id = $2', [pack.rows[0].id, parseInt(req.params.userId)])
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// ============ WATCH PAIRING ============

// Store pairing codes in memory (they expire quickly)
const pairingCodes = new Map() // code -> { userId, syncToken, expiresAt }

// POST /api/watch/pair-code — phone requests a temporary pairing code
app.post('/api/watch/pair-code', authenticateToken, async (req, res) => {
  try {
    // Generate a sync token (permanent) for this user if not already stored
    let result = await pool.query('SELECT sync_token FROM users WHERE id = $1', [req.user.userId])
    let syncToken = result.rows[0]?.sync_token

    if (!syncToken) {
      syncToken = crypto.randomUUID()
      await pool.query('UPDATE users SET sync_token = $1 WHERE id = $2', [syncToken, req.user.userId])
    }

    // Generate temporary 6-digit code
    let code
    for (let i = 0; i < 100; i++) {
      code = String(Math.floor(Math.random() * 1000000)).padStart(6, '0')
      if (!pairingCodes.has(code)) break
    }

    pairingCodes.set(code, {
      userId: req.user.userId,
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
app.post('/api/watch/pair', async (req, res) => {
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

// GET /api/watch/sync/:syncToken — watch fetches all user's packs
app.get('/api/watch/sync/:syncToken', async (req, res) => {
  try {
    const { syncToken } = req.params
    const user = await pool.query('SELECT id FROM users WHERE sync_token = $1', [syncToken])
    if (user.rows.length === 0) return res.status(401).json({ error: 'Invalid sync token' })

    const userId = user.rows[0].id
    const packsResult = await pool.query(`
      SELECT p.token, p.name, p.updated_at, p.question_lang, p.answer_lang
      FROM packs p
      WHERE p.user_id = $1
      ORDER BY p.updated_at DESC
    `, [userId])

    const packs = []
    for (const pack of packsResult.rows) {
      const words = await pool.query(
        'SELECT question, answer, reading, audio FROM words WHERE pack_id = (SELECT id FROM packs WHERE token = $1) AND enabled = true ORDER BY id',
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

// ============ AUDIO ROUTES ============

// POST /api/audio — upload audio, returns filename
app.post('/api/audio', authenticateToken, (req, res) => {
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
app.get('/api/audio/:filename', (req, res) => {
  const filePath = join(uploadsDir, req.params.filename)
  if (!existsSync(filePath)) return res.status(404).json({ error: 'Not found' })
  res.sendFile(filePath)
})

// DELETE /api/audio/:filename — delete audio file
app.delete('/api/audio/:filename', authenticateToken, (req, res) => {
  const filePath = join(uploadsDir, req.params.filename)
  if (existsSync(filePath)) unlinkSync(filePath)
  res.json({ ok: true })
})

// ============ PACK ROUTES ============

// GET /api/packs — list user's packs
app.get('/api/packs', authenticateToken, async (req, res) => {
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
    `, [req.user.userId])
    res.json(result.rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/packs/browse — browse public packs
app.get('/api/packs/browse', async (req, res) => {
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
    const params = []

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

// GET /api/words/:token — consumed by watch/phone app (public, no auth)
app.get('/api/words/:token', optionalAuth, async (req, res) => {
  try {
    const { token } = req.params
    const pack = await pool.query(`
      SELECT p.id, p.name, p.updated_at, p.question_lang, p.answer_lang, p.download_count, u.display_name AS author
      FROM packs p LEFT JOIN users u ON u.id = p.user_id
      WHERE p.token = $1
    `, [token])
    if (pack.rows.length === 0) return res.status(404).json({ error: 'Pack not found' })

    const packId = pack.rows[0].id
    const userId = req.user?.id

    // Only increment if this user hasn't downloaded this pack before
    let downloadCount = pack.rows[0].download_count || 0
    if (userId) {
      const existing = await pool.query('SELECT id FROM pack_downloads WHERE pack_id = $1 AND user_id = $2', [packId, userId])
      if (existing.rows.length === 0) {
        await pool.query('INSERT INTO pack_downloads (pack_id, user_id) VALUES ($1, $2)', [packId, userId])
        await pool.query('UPDATE packs SET download_count = download_count + 1 WHERE token = $1', [token])
        downloadCount++
      }
    }

    const words = await pool.query(
      'SELECT question, answer, reading, audio FROM words WHERE pack_id = $1 AND enabled = true ORDER BY id',
      [packId]
    )
    const p = pack.rows[0]
    res.json({ name: p.name, updated_at: p.updated_at, question_lang: p.question_lang || '', answer_lang: p.answer_lang || '', author: p.author || '', download_count: downloadCount, words: words.rows })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/packs/:token/edit — all words including disabled
app.get('/api/packs/:token/edit', authenticateToken, async (req, res) => {
  try {
    const { token } = req.params
    const pack = await pool.query('SELECT id, name, is_public, tags, question_lang, answer_lang, updated_at, user_id FROM packs WHERE token = $1', [token])
    if (pack.rows.length === 0) return res.status(404).json({ error: 'Pack not found' })
    if (pack.rows[0].user_id && pack.rows[0].user_id !== req.user.userId) {
      const collab = await pool.query('SELECT 1 FROM pack_collaborators pc JOIN packs p ON p.id = pc.pack_id WHERE p.token = $1 AND pc.user_id = $2', [token, req.user.userId])
      if (collab.rows.length === 0) return res.status(403).json({ error: 'Not your pack' })
    }

    const words = await pool.query(
      'SELECT question, answer, reading, enabled, audio FROM words WHERE pack_id = $1 ORDER BY id',
      [pack.rows[0].id]
    )
    res.json({ name: pack.rows[0].name, is_public: pack.rows[0].is_public, tags: pack.rows[0].tags || '', question_lang: pack.rows[0].question_lang || '', answer_lang: pack.rows[0].answer_lang || '', updated_at: pack.rows[0].updated_at, words: words.rows })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/packs — create a new word pack
app.post('/api/packs', authenticateToken, async (req, res) => {
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
      [token, name || '', req.user.userId, is_public || false, tags || '', question_lang || '', answer_lang || '']
    )
    const packId = pack.rows[0].id

    for (const word of words) {
      await client.query(
        'INSERT INTO words (pack_id, question, answer, reading, enabled, audio) VALUES ($1, $2, $3, $4, $5, $6)',
        [packId, word.question, word.answer, word.reading || '', word.enabled !== false, word.audio || '']
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
app.put('/api/packs/:token', authenticateToken, async (req, res) => {
  const client = await pool.connect()
  try {
    const { token } = req.params
    const { name, words, is_public, tags, question_lang, answer_lang } = req.body
    if (!words || !Array.isArray(words) || words.length === 0) {
      return res.status(400).json({ error: 'Words array is required' })
    }

    const pack = await client.query('SELECT id, user_id FROM packs WHERE token = $1', [token])
    if (pack.rows.length === 0) return res.status(404).json({ error: 'Pack not found' })
    if (pack.rows[0].user_id && pack.rows[0].user_id !== req.user.userId) {
      const collab = await client.query('SELECT 1 FROM pack_collaborators pc JOIN packs p ON p.id = pc.pack_id WHERE p.token = $1 AND pc.user_id = $2', [token, req.user.userId])
      if (collab.rows.length === 0) return res.status(403).json({ error: 'Not your pack' })
    }

    const packId = pack.rows[0].id
    await client.query('BEGIN')
    await client.query('UPDATE packs SET name = $1, is_public = $2, tags = $3, question_lang = $4, answer_lang = $5, updated_at = NOW() WHERE id = $6', [name || '', is_public || false, tags || '', question_lang || '', answer_lang || '', packId])

    // Find old audio files to clean up
    const oldWords = await client.query('SELECT audio FROM words WHERE pack_id = $1 AND audio IS NOT NULL AND audio != \'\'', [packId])
    const newAudioFiles = new Set(words.map(w => w.audio).filter(Boolean))
    for (const oldWord of oldWords.rows) {
      if (!newAudioFiles.has(oldWord.audio)) {
        const filePath = join(uploadsDir, oldWord.audio)
        if (existsSync(filePath)) unlinkSync(filePath)
      }
    }

    await client.query('DELETE FROM words WHERE pack_id = $1', [packId])

    for (const word of words) {
      await client.query(
        'INSERT INTO words (pack_id, question, answer, reading, enabled, audio) VALUES ($1, $2, $3, $4, $5, $6)',
        [packId, word.question, word.answer, word.reading || '', word.enabled !== false, word.audio || '']
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
app.delete('/api/packs/:token', authenticateToken, async (req, res) => {
  try {
    const { token } = req.params
    const pack = await pool.query('SELECT id, user_id FROM packs WHERE token = $1', [token])
    if (pack.rows.length === 0) return res.status(404).json({ error: 'Pack not found' })
    if (pack.rows[0].user_id && pack.rows[0].user_id !== req.user.userId) {
      return res.status(403).json({ error: 'Not your pack' })
    }

    // Delete audio files
    const words = await pool.query('SELECT audio FROM words WHERE pack_id = $1 AND audio IS NOT NULL AND audio != \'\'', [pack.rows[0].id])
    for (const word of words.rows) {
      const filePath = join(uploadsDir, word.audio)
      if (existsSync(filePath)) unlinkSync(filePath)
    }

    await pool.query('DELETE FROM packs WHERE token = $1', [token])
    res.json({ ok: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/packs/:token/rate — rate a pack (1-5 stars)
app.post('/api/packs/:token/rate', authenticateToken, async (req, res) => {
  try {
    const { token } = req.params
    const { rating } = req.body
    if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating must be 1-5' })

    const pack = await pool.query('SELECT id FROM packs WHERE token = $1', [token])
    if (pack.rows.length === 0) return res.status(404).json({ error: 'Pack not found' })

    await pool.query(`
      INSERT INTO pack_ratings (pack_id, user_id, rating) VALUES ($1, $2, $3)
      ON CONFLICT (pack_id, user_id) DO UPDATE SET rating = $3
    `, [pack.rows[0].id, req.user.userId, rating])

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
app.get('/api/packs/:token/rating', optionalAuth, async (req, res) => {
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

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  const distPath = resolve(__dirname, '../dist')
  if (existsSync(distPath)) {
    app.use(express.static(distPath))
    app.get('*', (req, res) => {
      res.sendFile(resolve(distPath, 'index.html'))
    })
  }
}

initDb().then(() => {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`))
}).catch(err => {
  console.error('Failed to init database:', err)
  process.exit(1)
})
