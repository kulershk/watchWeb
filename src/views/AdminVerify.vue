<template>
  <!-- Login screen -->
  <div v-if="!authed" class="flex items-center justify-center min-h-[60vh]">
    <div class="bg-surface border border-border rounded-lg p-6 w-full max-w-sm space-y-4">
      <h1 class="text-xl font-bold text-center">Admin Login</h1>
      <p v-if="loginError" class="text-danger text-sm text-center">{{ loginError }}</p>
      <input v-model="email" type="email" placeholder="Email"
        class="w-full bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm focus:border-primary"
        @keyup.enter="login" />
      <input v-model="password" type="password" placeholder="Password"
        class="w-full bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm focus:border-primary"
        @keyup.enter="login" />
      <button @click="login" :disabled="loggingIn"
        class="w-full bg-primary hover:bg-primary-hover text-bg font-semibold py-2 rounded-lg transition-colors disabled:opacity-50">
        {{ loggingIn ? 'Logging in...' : 'Login' }}
      </button>

      <div v-if="googleClientId" class="relative">
        <div class="absolute inset-0 flex items-center"><div class="w-full border-t border-border"></div></div>
        <div class="relative flex justify-center text-xs"><span class="bg-surface px-2 text-text-muted">or</span></div>
      </div>

      <div v-if="googleClientId" ref="googleBtnRef" class="flex justify-center"></div>
    </div>
  </div>

  <!-- Admin panel -->
  <div v-else class="space-y-6">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold">Pack Verification</h1>
      <div class="flex items-center gap-3">
        <select v-model="statusFilter" @change="loadPacks"
          class="bg-surface border border-border text-text text-sm rounded-lg px-3 py-2">
          <option value="pending">Pending</option>
          <option value="accepted">Accepted</option>
          <option value="denied">Denied</option>
          <option value="neutral">Neutral</option>
          <option value="all">All</option>
        </select>
        <button @click="logout"
          class="text-text-muted hover:text-text text-sm transition-colors">
          Logout
        </button>
      </div>
    </div>

    <p v-if="loading" class="text-text-muted">Loading...</p>
    <p v-else-if="error" class="text-danger text-sm">{{ error }}</p>
    <p v-else-if="packs.length === 0" class="text-text-muted">No packs with status "{{ statusFilter }}".</p>

    <div v-else class="space-y-3">
      <div v-for="pack in packs" :key="pack.id"
        class="bg-surface border border-border rounded-lg p-4">
        <div class="flex items-start justify-between gap-4">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-mono text-accent font-bold">#{{ pack.id }}</span>
              <span class="text-text font-medium">{{ pack.name || 'Unnamed pack' }}</span>
              <span class="text-xs px-2 py-0.5 rounded-full" :class="statusBadgeClass(pack.verification_status)">
                {{ pack.verification_status }}
              </span>
            </div>
            <div class="text-text-muted text-xs mt-1">
              {{ pack.word_count }} words
              <span v-if="pack.author"> &middot; by {{ pack.author }}</span>
              <span v-if="pack.tags"> &middot; {{ pack.tags }}</span>
              <span v-if="pack.question_lang || pack.answer_lang"> &middot; {{ pack.question_lang || '?' }} → {{ pack.answer_lang || '?' }}</span>
            </div>
            <div class="text-text-muted text-xs">
              Updated {{ formatDate(pack.updated_at) }}
              <span v-if="pack.download_count"> &middot; {{ pack.download_count }} downloads</span>
            </div>

            <!-- Word preview toggle -->
            <button @click="togglePreview(pack.id)" class="text-primary text-xs mt-1 hover:underline">
              {{ expandedPack === pack.id ? 'Hide words' : 'Show words' }}
            </button>
            <div v-if="expandedPack === pack.id" class="mt-2 space-y-1">
              <p v-if="previewLoading" class="text-text-muted text-xs">Loading words...</p>
              <div v-else-if="previewWords.length > 0"
                class="bg-bg border border-border rounded-lg p-3 max-h-80 overflow-y-auto space-y-1">
                <div v-for="(word, i) in previewWords" :key="i"
                  class="py-1.5" :class="{ 'border-t border-border': i > 0 }">
                  <!-- Image -->
                  <img v-if="word.image" :src="'/api/images/' + word.image"
                    class="max-h-24 rounded mb-1" loading="lazy" />
                  <div class="flex items-center gap-2 text-xs">
                    <!-- Audio button -->
                    <button v-if="word.audio" @click="playAudio(word.audio)"
                      class="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center transition-colors"
                      :class="playingAudio === word.audio ? 'bg-primary/50' : 'bg-primary hover:bg-primary-hover'">
                      <span class="text-bg text-[10px]">{{ playingAudio === word.audio ? '■' : '▶' }}</span>
                    </button>
                    <span class="text-text flex-1">{{ word.question }}</span>
                    <span class="text-primary flex-1 text-right">{{ word.answer }}</span>
                  </div>
                  <div v-if="word.reading" class="text-[10px] text-text-muted ml-8">{{ word.reading }}</div>
                </div>
              </div>
              <p v-else class="text-text-muted text-xs">No words found.</p>
            </div>
          </div>
          <div class="flex gap-2 flex-shrink-0">
            <router-link :to="'/admin/edit/' + pack.id"
              class="px-3 py-1 text-xs font-semibold rounded-lg transition-colors bg-blue-600 hover:bg-blue-700 text-white">
              Edit
            </router-link>
            <button @click="setStatus(pack.id, 'accepted')"
              class="px-3 py-1 text-xs font-semibold rounded-lg transition-colors"
              :class="pack.verification_status === 'accepted' ? 'bg-green-900 text-green-400 cursor-default' : 'bg-green-600 hover:bg-green-700 text-white'"
              :disabled="pack.verification_status === 'accepted'">
              Accept
            </button>
            <button @click="setStatus(pack.id, 'denied')"
              class="px-3 py-1 text-xs font-semibold rounded-lg transition-colors"
              :class="pack.verification_status === 'denied' ? 'bg-red-900 text-red-400 cursor-default' : 'bg-red-600 hover:bg-red-700 text-white'"
              :disabled="pack.verification_status === 'denied'">
              Deny
            </button>
            <button @click="setStatus(pack.id, 'neutral')"
              class="px-3 py-1 text-xs font-semibold rounded-lg transition-colors"
              :class="pack.verification_status === 'neutral' ? 'bg-gray-800 text-gray-400 cursor-default' : 'bg-gray-600 hover:bg-gray-700 text-white'"
              :disabled="pack.verification_status === 'neutral'">
              Neutral
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from 'vue'

declare const google: any

interface Pack {
  id: number
  name: string
  verification_status: string
  is_public: boolean
  tags: string
  question_lang: string
  answer_lang: string
  download_count: number
  updated_at: string
  author: string
  word_count: number
}

interface PreviewWord {
  question: string
  answer: string
  reading: string
  audio: string
  image: string
}

// Auth state
const authed = ref(false)
const email = ref('')
const password = ref('')
const loginError = ref('')
const loggingIn = ref(false)
const token = ref(localStorage.getItem('admin_token') || '')
const googleClientId = ref('')
const googleBtnRef = ref<HTMLElement | null>(null)

// Pack list state
const packs = ref<Pack[]>([])
const loading = ref(false)
const error = ref('')
const statusFilter = ref('pending')

// Preview state
const expandedPack = ref<number | null>(null)
const previewWords = ref<PreviewWord[]>([])
const previewLoading = ref(false)
const playingAudio = ref('')
let currentAudio: HTMLAudioElement | null = null

function playAudio(filename: string) {
  if (currentAudio) {
    currentAudio.pause()
    currentAudio = null
  }
  if (playingAudio.value === filename) {
    playingAudio.value = ''
    return
  }
  playingAudio.value = filename
  currentAudio = new Audio(`/api/audio/${filename}`)
  currentAudio.onended = () => { playingAudio.value = ''; currentAudio = null }
  currentAudio.onerror = () => { playingAudio.value = ''; currentAudio = null }
  currentAudio.play()
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString()
}

function statusBadgeClass(status: string) {
  switch (status) {
    case 'accepted': return 'bg-green-900 text-green-300'
    case 'denied': return 'bg-red-900 text-red-300'
    case 'pending': return 'bg-yellow-900 text-yellow-300'
    case 'neutral': return 'bg-gray-700 text-gray-300'
    default: return 'bg-gray-700 text-gray-300'
  }
}

async function verifyAdminAndFinish(jwt: string) {
  const meRes = await fetch('/api/auth/me', {
    headers: { Authorization: `Bearer ${jwt}` }
  })
  const me = await meRes.json()
  if (!me.isAdmin) {
    token.value = ''
    throw new Error('This account does not have admin access')
  }
  token.value = jwt
  localStorage.setItem('admin_token', jwt)
  authed.value = true
  loadPacks()
}

async function login() {
  loginError.value = ''
  loggingIn.value = true
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.value, password: password.value })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Login failed')
    await verifyAdminAndFinish(data.token)
  } catch (e: any) {
    loginError.value = e.message
  } finally {
    loggingIn.value = false
  }
}

async function handleGoogleCredential(response: any) {
  loginError.value = ''
  loggingIn.value = true
  try {
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: response.credential })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Google sign-in failed')
    await verifyAdminAndFinish(data.token)
  } catch (e: any) {
    loginError.value = e.message
  } finally {
    loggingIn.value = false
  }
}

let googleInitialized = false

function initGoogleButton() {
  if (!googleClientId.value || !googleBtnRef.value) return
  if (typeof google === 'undefined' || !google.accounts) return
  if (!googleInitialized) {
    google.accounts.id.initialize({
      client_id: googleClientId.value,
      callback: handleGoogleCredential
    })
    googleInitialized = true
  }
  // Clear any previous render
  googleBtnRef.value.innerHTML = ''
  google.accounts.id.renderButton(googleBtnRef.value, {
    theme: 'filled_black',
    size: 'large',
    width: 320,
    text: 'signin_with'
  })
}

function waitForGoogleAndRender() {
  if (typeof google !== 'undefined' && google.accounts && googleBtnRef.value) {
    initGoogleButton()
  } else {
    setTimeout(waitForGoogleAndRender, 200)
  }
}

// Re-render google button when ref becomes available
watch(googleBtnRef, (el) => {
  if (el) nextTick(() => waitForGoogleAndRender())
})

function logout() {
  token.value = ''
  authed.value = false
  localStorage.removeItem('admin_token')
  packs.value = []
}

async function checkExistingToken() {
  if (!token.value) return
  try {
    const res = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token.value}` }
    })
    if (!res.ok) throw new Error()
    const me = await res.json()
    if (!me.isAdmin) throw new Error()
    authed.value = true
    loadPacks()
  } catch {
    localStorage.removeItem('admin_token')
    token.value = ''
  }
}

async function loadPacks() {
  loading.value = true
  error.value = ''
  try {
    const res = await fetch(`/api/packs/admin/pending?status=${statusFilter.value}`, {
      headers: { Authorization: `Bearer ${token.value}` }
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || 'Failed to load packs')
    }
    packs.value = await res.json()
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

async function setStatus(packId: number, status: string) {
  try {
    const res = await fetch(`/api/packs/${packId}/verify`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token.value}`
      },
      body: JSON.stringify({ status })
    })
    if (!res.ok) throw new Error('Failed to update status')
    const pack = packs.value.find(p => p.id === packId)
    if (pack) pack.verification_status = status
  } catch (e: any) {
    alert(e.message)
  }
}

async function togglePreview(packId: number) {
  if (expandedPack.value === packId) {
    expandedPack.value = null
    return
  }
  expandedPack.value = packId
  previewWords.value = []
  previewLoading.value = true
  try {
    const res = await fetch(`/api/words/${packId}`)
    if (!res.ok) throw new Error()
    const data = await res.json()
    previewWords.value = data.words || []
  } catch {
    previewWords.value = []
  } finally {
    previewLoading.value = false
  }
}

onMounted(async () => {
  // Fetch Google Client ID from backend
  try {
    const res = await fetch('/api/config')
    const config = await res.json()
    if (config.googleClientId) {
      googleClientId.value = config.googleClientId
    }
  } catch {}

  checkExistingToken()
})
</script>
