import express, { Response } from 'express'
import cors from 'cors'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'
import { PORT, GOOGLE_CLIENT_ID } from './config.js'
import { pool, initDb } from './db.js'
import { optionalAuth, AuthenticatedRequest } from './middleware/auth.js'
import authRoutes from './routes/auth.js'
import packsRoutes from './routes/packs.js'
import ratingsRoutes from './routes/ratings.js'
import collaboratorsRoutes from './routes/collaborators.js'
import watchRoutes from './routes/watch.js'
import audioRoutes from './routes/audio.js'
import imageRoutes from './routes/images.js'
import swaggerUi from 'swagger-ui-express'
import { swaggerSpec } from './swagger.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()

app.use(cors())
app.use(express.json({ limit: '10mb' }))

// Swagger docs
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec))
app.get('/api/docs.json', (_req, res) => res.json(swaggerSpec))

// Routes
app.use('/api/auth', authRoutes)
app.use('/api/packs', packsRoutes)
app.use('/api/packs', ratingsRoutes)
app.use('/api', collaboratorsRoutes)
app.use('/api/watch', watchRoutes)
app.use('/api/audio', audioRoutes)
app.use('/api/images', imageRoutes)

// GET /api/config — public frontend config
app.get('/api/config', (_req, res) => {
  res.json({ googleClientId: GOOGLE_CLIENT_ID || null })
})

// GET /api/version — returns latest app versions for update checks
app.get('/api/version', async (_req, res) => {
  try {
    const result = await pool.query(`SELECT key, value FROM app_settings WHERE key IN ('phone_version', 'watch_version')`)
    const settings: Record<string, string> = {}
    for (const row of result.rows) settings[row.key] = row.value
    res.json({ phone: settings.phone_version || '', watch: settings.watch_version || '' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// GET /api/words/:id — consumed by watch/phone app (public, no auth)
app.get('/api/words/:id', optionalAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params
    const pack = await pool.query(`
      SELECT p.id, p.name, p.updated_at, p.question_lang, p.answer_lang, p.download_count, p.tags, p.verification_status,
        u.display_name AS author,
        COALESCE(AVG(pr.rating), 0) AS avg_rating, COUNT(DISTINCT pr.id)::int AS rating_count
      FROM packs p LEFT JOIN users u ON u.id = p.user_id
      LEFT JOIN pack_ratings pr ON pr.pack_id = p.id
      WHERE p.id = $1
      GROUP BY p.id, u.display_name
    `, [id])
    if (pack.rows.length === 0) return res.status(404).json({ error: 'Pack not found' })

    const packId = pack.rows[0].id
    const userId = req.user?.userId

    // Only increment if this user hasn't downloaded this pack before
    let downloadCount = pack.rows[0].download_count || 0
    if (userId) {
      const existing = await pool.query('SELECT id FROM pack_downloads WHERE pack_id = $1 AND user_id = $2', [packId, userId])
      if (existing.rows.length === 0) {
        await pool.query('INSERT INTO pack_downloads (pack_id, user_id) VALUES ($1, $2)', [packId, userId])
        await pool.query('UPDATE packs SET download_count = download_count + 1 WHERE id = $1', [id])
        downloadCount++
      }
    }

    const words = await pool.query(
      'SELECT question, answer, reading, audio, image FROM words WHERE pack_id = $1 AND enabled = true ORDER BY id',
      [packId]
    )
    const p = pack.rows[0]
    res.json({ name: p.name, updated_at: p.updated_at, question_lang: p.question_lang || '', answer_lang: p.answer_lang || '', author: p.author || '', download_count: downloadCount, tags: p.tags || '', verification_status: p.verification_status || 'none', avg_rating: parseFloat(p.avg_rating) || 0, rating_count: p.rating_count || 0, words: words.rows })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
})

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  const distPath = resolve(__dirname, '../../dist')
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
