import { pool } from '../db.js'

// Generate unique 4-digit token
export async function generateToken(): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const token = String(Math.floor(Math.random() * 10000)).padStart(4, '0')
    const existing = await pool.query('SELECT 1 FROM packs WHERE token = $1', [token])
    if (existing.rows.length === 0) return token
  }
  throw new Error('Could not generate unique token')
}

// Generate unique 6-character friend code
export async function generateFriendCode(): Promise<string> {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  for (let attempt = 0; attempt < 100; attempt++) {
    let code = ''
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)]
    const existing = await pool.query('SELECT 1 FROM users WHERE friend_code = $1', [code])
    if (existing.rows.length === 0) return code
  }
  throw new Error('Could not generate unique friend code')
}
