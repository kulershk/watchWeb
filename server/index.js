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
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS packs (
      id SERIAL PRIMARY KEY,
      token VARCHAR(4) UNIQUE NOT NULL,
      name TEXT DEFAULT '',
      user_id INTEGER REFERENCES users(id),
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
  `)
  await pool.query(`
    ALTER TABLE packs ADD COLUMN IF NOT EXISTS name TEXT DEFAULT '';
    ALTER TABLE packs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
    ALTER TABLE packs ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id);
    ALTER TABLE words ADD COLUMN IF NOT EXISTS enabled BOOLEAN DEFAULT TRUE;
    ALTER TABLE words ADD COLUMN IF NOT EXISTS audio VARCHAR(255) DEFAULT '';
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
    const result = await pool.query(
      'INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id, email, display_name',
      [email.toLowerCase(), passwordHash, displayName || '']
    )
    const user = result.rows[0]
    const token = createToken(user)
    res.json({ token, user: { id: user.id, email: user.email, displayName: user.display_name } })
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

    const result = await pool.query('SELECT id, email, password_hash, display_name FROM users WHERE email = $1', [email.toLowerCase()])
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid email or password' })

    const user = result.rows[0]
    if (!user.password_hash) return res.status(401).json({ error: 'This account uses Google Sign-In' })

    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' })

    const token = createToken(user)
    res.json({ token, user: { id: user.id, email: user.email, displayName: user.display_name } })
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
    let result = await pool.query('SELECT id, email, display_name FROM users WHERE google_id = $1', [googleId])

    if (result.rows.length === 0) {
      // Check if user exists by email (registered with password)
      result = await pool.query('SELECT id, email, display_name FROM users WHERE email = $1', [email.toLowerCase()])
      if (result.rows.length > 0) {
        // Link Google ID to existing account
        await pool.query('UPDATE users SET google_id = $1 WHERE id = $2', [googleId, result.rows[0].id])
      } else {
        // Create new user
        result = await pool.query(
          'INSERT INTO users (email, google_id, display_name) VALUES ($1, $2, $3) RETURNING id, email, display_name',
          [email.toLowerCase(), googleId, name || '']
        )
      }
    }

    const user = result.rows[0]
    const token = createToken(user)
    res.json({ token, user: { id: user.id, email: user.email, displayName: user.display_name } })
  } catch (err) {
    console.error(err)
    res.status(401).json({ error: 'Invalid Google token' })
  }
})

// GET /api/auth/me
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, email, display_name FROM users WHERE id = $1', [req.user.userId])
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' })
    const user = result.rows[0]
    res.json({ id: user.id, email: user.email, displayName: user.display_name })
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
      SELECT p.token, p.name, p.created_at, p.updated_at, COUNT(w.id)::int AS word_count
      FROM packs p
      LEFT JOIN words w ON w.pack_id = p.id
      WHERE p.user_id = $1
      GROUP BY p.id
      ORDER BY p.updated_at DESC
    `, [req.user.userId])
    res.json(result.rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/words/:token — consumed by watch/phone app (public, no auth)
app.get('/api/words/:token', async (req, res) => {
  try {
    const { token } = req.params
    const pack = await pool.query('SELECT id, name, updated_at FROM packs WHERE token = $1', [token])
    if (pack.rows.length === 0) return res.status(404).json({ error: 'Pack not found' })

    const words = await pool.query(
      'SELECT question, answer, reading, audio FROM words WHERE pack_id = $1 AND enabled = true ORDER BY id',
      [pack.rows[0].id]
    )
    res.json({ name: pack.rows[0].name, updated_at: pack.rows[0].updated_at, words: words.rows })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/packs/:token/edit — all words including disabled
app.get('/api/packs/:token/edit', authenticateToken, async (req, res) => {
  try {
    const { token } = req.params
    const pack = await pool.query('SELECT id, name, updated_at, user_id FROM packs WHERE token = $1', [token])
    if (pack.rows.length === 0) return res.status(404).json({ error: 'Pack not found' })
    if (pack.rows[0].user_id && pack.rows[0].user_id !== req.user.userId) {
      return res.status(403).json({ error: 'Not your pack' })
    }

    const words = await pool.query(
      'SELECT question, answer, reading, enabled, audio FROM words WHERE pack_id = $1 ORDER BY id',
      [pack.rows[0].id]
    )
    res.json({ name: pack.rows[0].name, updated_at: pack.rows[0].updated_at, words: words.rows })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/packs — create a new word pack
app.post('/api/packs', authenticateToken, async (req, res) => {
  const client = await pool.connect()
  try {
    const { name, words, token: customToken } = req.body
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
      'INSERT INTO packs (token, name, user_id) VALUES ($1, $2, $3) RETURNING id',
      [token, name || '', req.user.userId]
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
    const { name, words } = req.body
    if (!words || !Array.isArray(words) || words.length === 0) {
      return res.status(400).json({ error: 'Words array is required' })
    }

    const pack = await client.query('SELECT id, user_id FROM packs WHERE token = $1', [token])
    if (pack.rows.length === 0) return res.status(404).json({ error: 'Pack not found' })
    if (pack.rows[0].user_id && pack.rows[0].user_id !== req.user.userId) {
      return res.status(403).json({ error: 'Not your pack' })
    }

    const packId = pack.rows[0].id
    await client.query('BEGIN')
    await client.query('UPDATE packs SET name = $1, updated_at = NOW() WHERE id = $2', [name || '', packId])

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
