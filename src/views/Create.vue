<template>
  <div class="space-y-6">
    <h1 class="text-2xl font-bold">Create Word Pack</h1>

    <div v-if="createdToken" class="bg-surface rounded-lg p-6 border border-accent/30 text-center space-y-3">
      <p class="text-text-muted">Your word pack is ready! Enter this code on your watch:</p>
      <div class="text-4xl font-mono font-bold text-accent tracking-widest">{{ createdToken }}</div>
      <div class="flex gap-3 justify-center pt-2">
        <button @click="resetForm"
          class="bg-surface-light hover:bg-border text-text px-4 py-2 rounded-lg border border-border text-sm transition-colors">
          Create Another
        </button>
        <router-link :to="'/edit/' + createdToken"
          class="bg-primary hover:bg-primary-hover text-bg px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          Edit Pack
        </router-link>
      </div>
    </div>

    <form v-else @submit.prevent="submit" class="space-y-4">
      <div class="bg-surface rounded-lg p-4 border border-border">
        <label class="text-xs text-text-muted block mb-1">Pack Name</label>
        <input v-model="name" required placeholder="JLPT N5 Vocabulary"
          class="w-full bg-bg border border-border rounded px-3 py-2 text-text placeholder-text-muted/40 focus:border-primary transition-colors" />
      </div>

      <div class="bg-surface rounded-lg p-4 border border-border space-y-2">
        <label class="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" v-model="useCustomToken"
            class="w-4 h-4 accent-primary rounded" />
          <span class="text-xs text-text-muted">Set custom pack code</span>
        </label>
        <input v-if="useCustomToken" v-model="customToken" maxlength="4" pattern="\d{4}" placeholder="e.g. 1234"
          class="w-full bg-bg border border-border rounded px-3 py-2 text-text font-mono tracking-widest placeholder-text-muted/40 focus:border-primary transition-colors" />
      </div>

      <div v-for="(word, i) in words" :key="i"
        class="bg-surface rounded-lg p-4 border border-border space-y-3">
        <div class="flex items-center justify-between">
          <label class="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" v-model="word.enabled"
              class="w-4 h-4 accent-primary rounded" />
            <span class="text-sm" :class="word.enabled ? 'text-text-muted' : 'text-text-muted/50'">Word {{ i + 1 }}</span>
          </label>
          <button v-if="words.length > 1" type="button" @click="removeWord(i)"
            class="text-danger hover:text-red-300 text-sm transition-colors">Remove</button>
        </div>
        <div class="grid gap-3 sm:grid-cols-3" :class="{ 'opacity-40 pointer-events-none': !word.enabled }">
          <div>
            <label class="text-xs text-text-muted block mb-1">Question</label>
            <input v-model="word.question" :required="word.enabled" placeholder="犬"
              class="w-full bg-bg border border-border rounded px-3 py-2 text-text placeholder-text-muted/40 focus:border-primary transition-colors" />
          </div>
          <div>
            <label class="text-xs text-text-muted block mb-1">Answer</label>
            <input v-model="word.answer" :required="word.enabled" placeholder="dog"
              class="w-full bg-bg border border-border rounded px-3 py-2 text-text placeholder-text-muted/40 focus:border-primary transition-colors" />
          </div>
          <div>
            <label class="text-xs text-text-muted block mb-1">Reading (optional)</label>
            <input v-model="word.reading" placeholder="いぬ"
              class="w-full bg-bg border border-border rounded px-3 py-2 text-text placeholder-text-muted/40 focus:border-primary transition-colors" />
          </div>
        </div>
        <div class="flex items-center gap-2" :class="{ 'opacity-40 pointer-events-none': !word.enabled }">
          <label class="text-xs text-text-muted">Audio</label>
          <template v-if="word.audio">
            <button type="button" @click="playAudio(word.audio)"
              class="text-xs bg-accent/20 text-accent hover:bg-accent/30 px-2 py-1 rounded transition-colors">Play</button>
            <button type="button" @click="removeAudio(i)"
              class="text-xs text-danger hover:text-red-300 transition-colors">Remove</button>
          </template>
          <template v-else>
            <button v-if="recordingIndex !== i" type="button" @click="startRecording(i)"
              class="text-xs bg-danger/20 text-danger hover:bg-danger/30 px-2 py-1 rounded transition-colors">Record</button>
            <button v-else type="button" @click="stopRecording()"
              class="text-xs bg-danger text-bg px-2 py-1 rounded animate-pulse transition-colors">Stop</button>
          </template>
        </div>
      </div>

      <button type="button" @click="addWord"
        class="w-full border border-dashed border-border hover:border-primary text-text-muted hover:text-primary py-3 rounded-lg text-sm transition-colors">
        + Add Word
      </button>

      <!-- Import -->
      <div class="bg-surface rounded-lg p-4 border border-border space-y-2">
        <div class="flex items-center justify-between">
          <label class="text-xs text-text-muted">Import (question|answer|reading per line)</label>
          <button type="button" @click="showImport = !showImport" class="text-xs text-primary hover:text-primary-hover transition-colors">
            {{ showImport ? 'Hide' : 'Show' }}
          </button>
        </div>
        <template v-if="showImport">
          <textarea v-model="importText" rows="5" placeholder="犬|dog|いぬ&#10;猫|cat|ねこ&#10;水|water"
            class="w-full bg-bg border border-border rounded px-3 py-2 text-text text-sm font-mono placeholder-text-muted/40 focus:border-primary transition-colors resize-y" />
          <button type="button" @click="doImport"
            class="bg-accent hover:bg-accent-hover text-bg text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
            Import
          </button>
        </template>
      </div>

      <p v-if="error" class="text-danger text-sm">{{ error }}</p>

      <button type="submit" :disabled="submitting"
        class="w-full bg-primary hover:bg-primary-hover disabled:opacity-50 text-bg font-semibold py-3 rounded-lg transition-colors">
        {{ submitting ? 'Creating...' : 'Create Pack' }}
      </button>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

interface Word {
  question: string
  answer: string
  reading: string
  enabled: boolean
  audio: string
}

const name = ref('')
const words = ref<Word[]>([{ question: '', answer: '', reading: '', enabled: true, audio: '' }])
const createdToken = ref('')
const error = ref('')
const submitting = ref(false)
const customToken = ref('')
const useCustomToken = ref(false)
const showImport = ref(false)
const importText = ref('')
const recordingIndex = ref(-1)
let mediaRecorder: MediaRecorder | null = null

async function startRecording(i: number) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const chunks: Blob[] = []
    mediaRecorder = new MediaRecorder(stream)
    mediaRecorder.ondataavailable = (e) => chunks.push(e.data)
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop())
      const blob = new Blob(chunks, { type: mediaRecorder!.mimeType })
      const reader = new FileReader()
      reader.onloadend = async () => {
        const res = await fetch('/api/audio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: reader.result }),
        })
        if (res.ok) {
          const { filename } = await res.json()
          words.value[i].audio = filename
        }
      }
      reader.readAsDataURL(blob)
    }
    mediaRecorder.start()
    recordingIndex.value = i
  } catch {
    error.value = 'Microphone access denied'
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop()
  }
  recordingIndex.value = -1
}

function playAudio(filename: string) {
  new Audio(`/api/audio/${filename}`).play()
}

async function removeAudio(i: number) {
  const filename = words.value[i].audio
  if (filename) {
    await fetch(`/api/audio/${filename}`, { method: 'DELETE' })
    words.value[i].audio = ''
  }
}

function addWord() {
  words.value.push({ question: '', answer: '', reading: '', enabled: true, audio: '' })
}

function removeWord(i: number) {
  words.value.splice(i, 1)
}

function doImport() {
  const lines = importText.value.split('\n').filter(l => l.trim())
  const parsed = lines.map(line => {
    const [question, answer, reading] = line.split('|').map(s => s.trim())
    return { question: question || '', answer: answer || '', reading: reading || '', enabled: true }
  }).filter(w => w.question && w.answer)
  if (parsed.length === 0) return
  // Remove empty placeholder row
  if (words.value.length === 1 && !words.value[0].question && !words.value[0].answer) {
    words.value = parsed
  } else {
    words.value.push(...parsed)
  }
  importText.value = ''
  showImport.value = false
}

function resetForm() {
  name.value = ''
  words.value = [{ question: '', answer: '', reading: '', enabled: true, audio: '' }]
  createdToken.value = ''
  customToken.value = ''
  useCustomToken.value = false
  error.value = ''
}

async function submit() {
  error.value = ''
  submitting.value = true
  try {
    const res = await fetch('/api/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.value, words: words.value, token: useCustomToken.value ? customToken.value : undefined }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || 'Failed to create pack')
    }
    const data = await res.json()
    createdToken.value = data.token
  } catch (e: any) {
    error.value = e.message
  } finally {
    submitting.value = false
  }
}
</script>
