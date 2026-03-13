<template>
  <div class="space-y-6">
    <h1 class="text-2xl font-bold">Edit Word Pack</h1>

    <!-- Pack ID lookup -->
    <div v-if="!loaded" class="space-y-4">
      <form @submit.prevent="loadPack" class="flex gap-3">
        <input v-model="packId" required placeholder="Enter pack ID"
          class="flex-1 bg-surface border border-border rounded-lg px-4 py-3 text-text text-center text-xl font-mono tracking-widest placeholder-text-muted/40 focus:border-primary transition-colors" />
        <button type="submit" :disabled="loading"
          class="bg-primary hover:bg-primary-hover disabled:opacity-50 text-bg font-semibold px-6 py-3 rounded-lg transition-colors">
          {{ loading ? '...' : 'Load' }}
        </button>
      </form>
      <p v-if="error" class="text-danger text-sm">{{ error }}</p>
    </div>

    <!-- Edit form -->
    <template v-else>
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <span class="text-text-muted text-sm">Pack ID:</span>
          <span class="font-mono text-accent font-bold text-lg">{{ packId }}</span>
        </div>
        <button @click="reset" class="text-sm text-text-muted hover:text-text transition-colors">
          &larr; Different pack
        </button>
      </div>

      <form @submit.prevent="savePack" class="space-y-4">
        <div class="bg-surface rounded-lg p-4 border border-border">
          <label class="text-xs text-text-muted block mb-1">Pack Name</label>
          <input v-model="name" required
            class="w-full bg-bg border border-border rounded px-3 py-2 text-text focus:border-primary transition-colors" />
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
              <label class="text-xs text-text-muted block mb-1">Card</label>
              <input v-model="word.question" :required="word.enabled"
                class="w-full bg-bg border border-border rounded px-3 py-2 text-text focus:border-primary transition-colors" />
            </div>
            <div>
              <label class="text-xs text-text-muted block mb-1">Explanation</label>
              <input v-model="word.answer" :required="word.enabled"
                class="w-full bg-bg border border-border rounded px-3 py-2 text-text focus:border-primary transition-colors" />
            </div>
            <div>
              <label class="text-xs text-text-muted block mb-1">Hint</label>
              <input v-model="word.reading"
                class="w-full bg-bg border border-border rounded px-3 py-2 text-text focus:border-primary transition-colors" />
            </div>
          </div>
          <div :class="{ 'opacity-40 pointer-events-none': !word.enabled }">
            <AudioRecorder v-model="word.audio" @remove="removeAudio(i)" @error="e => error = e" />
          </div>
          <div :class="{ 'opacity-40 pointer-events-none': !word.enabled }">
            <div v-if="word.image" class="flex items-center gap-3">
              <img :src="'/api/images/' + word.image" class="max-h-20 rounded" loading="lazy" />
              <button type="button" @click="removeImage(i)"
                class="text-danger hover:text-red-300 text-xs transition-colors">Remove image</button>
            </div>
            <label v-else
              class="flex items-center gap-2 text-xs text-text-muted hover:text-primary cursor-pointer transition-colors">
              <span>+ Add image</span>
              <input type="file" accept="image/*" class="hidden" @change="e => uploadImage(e, i)" />
            </label>
          </div>
        </div>

        <button type="button" @click="addWord"
          class="w-full border border-dashed border-border hover:border-primary text-text-muted hover:text-primary py-3 rounded-lg text-sm transition-colors">
          + Add Word
        </button>

        <!-- Import -->
        <div class="bg-surface rounded-lg p-4 border border-border space-y-2">
          <div class="flex items-center justify-between">
            <label class="text-xs text-text-muted">Import (card|explanation|hint per line)</label>
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
        <p v-if="saved" class="text-accent text-sm">Pack saved!</p>

        <div class="flex gap-3">
          <button type="submit" :disabled="saving"
            class="flex-1 bg-primary hover:bg-primary-hover disabled:opacity-50 text-bg font-semibold py-3 rounded-lg transition-colors">
            {{ saving ? 'Saving...' : 'Save Changes' }}
          </button>
          <button type="button" @click="confirmDelete"
            class="bg-surface-light hover:bg-danger/20 text-danger border border-border px-4 py-3 rounded-lg text-sm transition-colors">
            Delete
          </button>
        </div>
      </form>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import AudioRecorder from '../components/AudioRecorder.vue'

interface Word {
  question: string
  answer: string
  reading: string
  enabled: boolean
  audio: string
  image: string
}

const route = useRoute()
const packId = ref('')
const authToken = localStorage.getItem('admin_token') || ''
const name = ref('')
const isPublic = ref(false)
const tags = ref('')
const questionLang = ref('')
const answerLang = ref('')
const words = ref<Word[]>([])
const loaded = ref(false)
const loading = ref(false)
const saving = ref(false)
const saved = ref(false)
const error = ref('')
const showImport = ref(false)
const importText = ref('')

async function removeAudio(i: number) {
  const filename = words.value[i].audio
  if (filename) {
    const audioHeaders: Record<string, string> = {}
    if (authToken) audioHeaders['Authorization'] = `Bearer ${authToken}`
    await fetch(`/api/audio/${filename}`, { method: 'DELETE', headers: audioHeaders })
    words.value[i].audio = ''
  }
}

onMounted(() => {
  const t = (route.params.id || route.params.token) as string
  if (t) {
    packId.value = t
    loadPack()
  }
})

async function loadPack() {
  error.value = ''
  loading.value = true
  try {
    const headers: Record<string, string> = {}
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`
    const res = await fetch(`/api/packs/${packId.value}/edit`, { headers })
    if (!res.ok) throw new Error('Pack not found')
    const data = await res.json()
    name.value = data.name || ''
    isPublic.value = data.is_public || false
    tags.value = data.tags || ''
    questionLang.value = data.question_lang || ''
    answerLang.value = data.answer_lang || ''
    words.value = data.words
    loaded.value = true
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

function doImport() {
  const lines = importText.value.split('\n').filter(l => l.trim())
  const parsed = lines.map(line => {
    const [question, answer, reading] = line.split('|').map(s => s.trim())
    return { question: question || '', answer: answer || '', reading: reading || '', enabled: true, audio: '', image: '' }
  }).filter(w => w.question && w.answer)
  if (parsed.length === 0) return
  words.value.push(...parsed)
  importText.value = ''
  showImport.value = false
}

function addWord() {
  words.value.push({ question: '', answer: '', reading: '', enabled: true, audio: '', image: '' })
}

async function uploadImage(event: Event, i: number) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = async () => {
    try {
      const uploadHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
      if (authToken) uploadHeaders['Authorization'] = `Bearer ${authToken}`
      const res = await fetch('/api/images', {
        method: 'POST',
        headers: uploadHeaders,
        body: JSON.stringify({ data: reader.result })
      })
      if (!res.ok) throw new Error('Upload failed')
      const data = await res.json()
      words.value[i].image = data.filename
    } catch (e: any) {
      error.value = e.message
    }
  }
  reader.readAsDataURL(file)
}

async function removeImage(i: number) {
  const filename = words.value[i].image
  if (filename) {
    const imgHeaders: Record<string, string> = {}
    if (authToken) imgHeaders['Authorization'] = `Bearer ${authToken}`
    await fetch(`/api/images/${filename}`, { method: 'DELETE', headers: imgHeaders })
    words.value[i].image = ''
  }
}

function removeWord(i: number) {
  words.value.splice(i, 1)
}

function reset() {
  loaded.value = false
  name.value = ''
  isPublic.value = false
  tags.value = ''
  questionLang.value = ''
  answerLang.value = ''
  words.value = []
  error.value = ''
  saved.value = false
  packId.value = ''
}

async function savePack() {
  error.value = ''
  saved.value = false
  saving.value = true
  try {
    const saveHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
    if (authToken) saveHeaders['Authorization'] = `Bearer ${authToken}`
    const res = await fetch(`/api/packs/${packId.value}`, {
      method: 'PUT',
      headers: saveHeaders,
      body: JSON.stringify({ name: name.value, words: words.value, is_public: isPublic.value, tags: tags.value, question_lang: questionLang.value, answer_lang: answerLang.value }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || 'Failed to save')
    }
    saved.value = true
  } catch (e: any) {
    error.value = e.message
  } finally {
    saving.value = false
  }
}

async function confirmDelete() {
  if (!confirm('Delete this word pack? This cannot be undone.')) return
  try {
    const delHeaders: Record<string, string> = {}
    if (authToken) delHeaders['Authorization'] = `Bearer ${authToken}`
    const res = await fetch(`/api/packs/${packId.value}`, { method: 'DELETE', headers: delHeaders })
    if (!res.ok) throw new Error('Failed to delete')
    reset()
  } catch (e: any) {
    error.value = e.message
  }
}
</script>
