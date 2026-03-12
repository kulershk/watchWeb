import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { existsSync, mkdirSync } from 'fs'
import { OAuth2Client } from 'google-auth-library'

const __dirname = dirname(fileURLToPath(import.meta.url))

export const PORT = 3001
export const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production'
export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''
export const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID)

// uploads/ lives at server/uploads/, not inside src/
export const uploadsDir = join(__dirname, '../../uploads')
if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true })
