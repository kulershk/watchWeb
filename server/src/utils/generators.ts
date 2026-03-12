import { pool } from '../db.js'

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

// Generate unique 8-character share code
export async function generateShareCode(): Promise<string> {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  for (let attempt = 0; attempt < 100; attempt++) {
    let code = ''
    for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)]
    const existing = await pool.query('SELECT 1 FROM pack_share_codes WHERE code = $1', [code])
    if (existing.rows.length === 0) return code
  }
  throw new Error('Could not generate unique share code')
}
