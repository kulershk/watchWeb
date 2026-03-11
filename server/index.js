import express from 'express'
import cors from 'cors'
import pg from 'pg'
import crypto from 'crypto'
import { resolve, dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = 3001

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
    CREATE TABLE IF NOT EXISTS packs (
      id SERIAL PRIMARY KEY,
      token VARCHAR(4) UNIQUE NOT NULL,
      name TEXT DEFAULT '',
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
  // Add columns if missing (migration for existing DBs)
  await pool.query(`
    ALTER TABLE packs ADD COLUMN IF NOT EXISTS name TEXT DEFAULT '';
    ALTER TABLE packs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
    ALTER TABLE words ADD COLUMN IF NOT EXISTS enabled BOOLEAN DEFAULT TRUE;
    ALTER TABLE words ADD COLUMN IF NOT EXISTS audio VARCHAR(255) DEFAULT '';
  `).catch(() => {})
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

// POST /api/audio — upload audio, returns filename
app.post('/api/audio', (req, res) => {
  try {
    const { data } = req.body
    if (!data) return res.status(400).json({ error: 'No audio data' })
    // data is base64-encoded audio (e.g. "data:audio/webm;codecs=opus;base64,...")
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

// GET /api/audio/:filename — serve audio file
app.get('/api/audio/:filename', (req, res) => {
  const filePath = join(uploadsDir, req.params.filename)
  if (!existsSync(filePath)) return res.status(404).json({ error: 'Not found' })
  res.sendFile(filePath)
})

// DELETE /api/audio/:filename — delete audio file
app.delete('/api/audio/:filename', (req, res) => {
  const filePath = join(uploadsDir, req.params.filename)
  if (existsSync(filePath)) unlinkSync(filePath)
  res.json({ ok: true })
})

// GET /api/packs — list all packs with word count
app.get('/api/packs', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.token, p.name, p.created_at, p.updated_at, COUNT(w.id)::int AS word_count
      FROM packs p
      LEFT JOIN words w ON w.pack_id = p.id
      GROUP BY p.id
      ORDER BY p.updated_at DESC
    `)
    res.json(result.rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/words/:token — consumed by the watch app
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

// GET /api/packs/:token/edit — all words including disabled, for the editor
app.get('/api/packs/:token/edit', async (req, res) => {
  try {
    const { token } = req.params
    const pack = await pool.query('SELECT id, name, updated_at FROM packs WHERE token = $1', [token])
    if (pack.rows.length === 0) return res.status(404).json({ error: 'Pack not found' })

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
app.post('/api/packs', async (req, res) => {
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
    const pack = await client.query('INSERT INTO packs (token, name) VALUES ($1, $2) RETURNING id', [token, name || ''])
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
app.put('/api/packs/:token', async (req, res) => {
  const client = await pool.connect()
  try {
    const { token } = req.params
    const { name, words } = req.body
    if (!words || !Array.isArray(words) || words.length === 0) {
      return res.status(400).json({ error: 'Words array is required' })
    }

    const pack = await client.query('SELECT id FROM packs WHERE token = $1', [token])
    if (pack.rows.length === 0) return res.status(404).json({ error: 'Pack not found' })

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
app.delete('/api/packs/:token', async (req, res) => {
  try {
    const { token } = req.params
    const pack = await pool.query('SELECT id FROM packs WHERE token = $1', [token])
    if (pack.rows.length === 0) return res.status(404).json({ error: 'Pack not found' })

    // Delete audio files for all words in the pack
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
