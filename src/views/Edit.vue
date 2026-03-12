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
              <label class="text-xs text-text-muted block mb-1">Question</label>
              <input v-model="word.question" :required="word.enabled"
                class="w-full bg-bg border border-border rounded px-3 py-2 text-text focus:border-primary transition-colors" />
            </div>
            <div>
              <label class="text-xs text-text-muted block mb-1">Answer</label>
              <input v-model="word.answer" :required="word.enabled"
                class="w-full bg-bg border border-border rounded px-3 py-2 text-text focus:border-primary transition-colors" />
            </div>
            <div>
              <label class="text-xs text-text-muted block mb-1">Reading</label>
              <input v-model="word.reading"
                class="w-full bg-bg border border-border rounded px-3 py-2 text-text focus:border-primary transition-colors" />
            </div>
          </div>
          <div :class="{ 'opacity-40 pointer-events-none': !word.enabled }">
            <AudioRecorder v-model="word.audio" @remove="removeAudio(i)" @error="e => error = e" />
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
}

const route = useRoute()
const packId = ref('')
const name = ref('')
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
    await fetch(`/api/audio/${filename}`, { method: 'DELETE' })
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
    const res = await fetch(`/api/packs/${packId.value}/edit`)
    if (!res.ok) throw new Error('Pack not found')
    const data = await res.json()
    name.value = data.name || ''
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
    return { question: question || '', answer: answer || '', reading: reading || '', enabled: true, audio: '' }
  }).filter(w => w.question && w.answer)
  if (parsed.length === 0) return
  words.value.push(...parsed)
  importText.value = ''
  showImport.value = false
}

function addWord() {
  words.value.push({ question: '', answer: '', reading: '', enabled: true, audio: '' })
}

function removeWord(i: number) {
  words.value.splice(i, 1)
}

function reset() {
  loaded.value = false
  name.value = ''
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
    const res = await fetch(`/api/packs/${packId.value}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.value, words: words.value }),
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
    const res = await fetch(`/api/packs/${packId.value}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('Failed to delete')
    reset()
  } catch (e: any) {
    error.value = e.message
  }
}
</script>
