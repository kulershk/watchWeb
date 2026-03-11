import express from 'express'
import cors from 'cors'
import pg from 'pg'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = 3001

app.use(cors())
app.use(express.json())

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://watch:watch@localhost:5432/watch',
})

// Init database
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS packs (
      id SERIAL PRIMARY KEY,
      token VARCHAR(4) UNIQUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS words (
      id SERIAL PRIMARY KEY,
      pack_id INTEGER REFERENCES packs(id) ON DELETE CASCADE,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      reading TEXT DEFAULT ''
    );
  `)
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

// GET /api/packs — list all packs with word count
app.get('/api/packs', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.token, p.created_at, COUNT(w.id)::int AS word_count
      FROM packs p
      LEFT JOIN words w ON w.pack_id = p.id
      GROUP BY p.id
      ORDER BY p.created_at DESC
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
    const pack = await pool.query('SELECT id FROM packs WHERE token = $1', [token])
    if (pack.rows.length === 0) return res.status(404).json({ error: 'Pack not found' })

    const words = await pool.query(
      'SELECT question, answer, reading FROM words WHERE pack_id = $1 ORDER BY id',
      [pack.rows[0].id]
    )
    res.json({ words: words.rows })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// POST /api/packs — create a new word pack
app.post('/api/packs', async (req, res) => {
  const client = await pool.connect()
  try {
    const { words } = req.body
    if (!words || !Array.isArray(words) || words.length === 0) {
      return res.status(400).json({ error: 'Words array is required' })
    }

    const token = await generateToken()
    await client.query('BEGIN')
    const pack = await client.query('INSERT INTO packs (token) VALUES ($1) RETURNING id', [token])
    const packId = pack.rows[0].id

    for (const word of words) {
      await client.query(
        'INSERT INTO words (pack_id, question, answer, reading) VALUES ($1, $2, $3, $4)',
        [packId, word.question, word.answer, word.reading || '']
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
    const { words } = req.body
    if (!words || !Array.isArray(words) || words.length === 0) {
      return res.status(400).json({ error: 'Words array is required' })
    }

    const pack = await client.query('SELECT id FROM packs WHERE token = $1', [token])
    if (pack.rows.length === 0) return res.status(404).json({ error: 'Pack not found' })

    const packId = pack.rows[0].id
    await client.query('BEGIN')
    await client.query('DELETE FROM words WHERE pack_id = $1', [packId])

    for (const word of words) {
      await client.query(
        'INSERT INTO words (pack_id, question, answer, reading) VALUES ($1, $2, $3, $4)',
        [packId, word.question, word.answer, word.reading || '']
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
    const result = await pool.query('DELETE FROM packs WHERE token = $1', [token])
    if (result.rowCount === 0) return res.status(404).json({ error: 'Pack not found' })
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
