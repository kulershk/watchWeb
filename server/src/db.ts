import pg from 'pg'

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://watch:watch@localhost:5432/watch',
})

export async function initDb() {
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
    ALTER TABLE words ADD COLUMN IF NOT EXISTS image VARCHAR(255) DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS friend_code VARCHAR(6) UNIQUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS watch_sync_packs TEXT DEFAULT '[]';
  `).catch(() => {})
}
