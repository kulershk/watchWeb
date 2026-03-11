<template>
  <div class="space-y-6">
    <h1 class="text-2xl font-bold">Edit Word Pack</h1>

    <!-- Token lookup -->
    <div v-if="!loaded" class="space-y-4">
      <form @submit.prevent="loadPack" class="flex gap-3">
        <input v-model="tokenInput" maxlength="4" pattern="\d{4}" required placeholder="Enter 4-digit token"
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
          <span class="text-text-muted text-sm">Token:</span>
          <span class="font-mono text-accent font-bold text-lg">{{ tokenInput }}</span>
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
            <span class="text-sm text-text-muted">Word {{ i + 1 }}</span>
            <button v-if="words.length > 1" type="button" @click="removeWord(i)"
              class="text-danger hover:text-red-300 text-sm transition-colors">Remove</button>
          </div>
          <div class="grid gap-3 sm:grid-cols-3">
            <div>
              <label class="text-xs text-text-muted block mb-1">Question</label>
              <input v-model="word.question" required
                class="w-full bg-bg border border-border rounded px-3 py-2 text-text focus:border-primary transition-colors" />
            </div>
            <div>
              <label class="text-xs text-text-muted block mb-1">Answer</label>
              <input v-model="word.answer" required
                class="w-full bg-bg border border-border rounded px-3 py-2 text-text focus:border-primary transition-colors" />
            </div>
            <div>
              <label class="text-xs text-text-muted block mb-1">Reading</label>
              <input v-model="word.reading"
                class="w-full bg-bg border border-border rounded px-3 py-2 text-text focus:border-primary transition-colors" />
            </div>
          </div>
        </div>

        <button type="button" @click="addWord"
          class="w-full border border-dashed border-border hover:border-primary text-text-muted hover:text-primary py-3 rounded-lg text-sm transition-colors">
          + Add Word
        </button>

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

interface Word {
  question: string
  answer: string
  reading: string
}

const route = useRoute()
const tokenInput = ref('')
const name = ref('')
const words = ref<Word[]>([])
const loaded = ref(false)
const loading = ref(false)
const saving = ref(false)
const saved = ref(false)
const error = ref('')

onMounted(() => {
  const t = route.params.token as string
  if (t) {
    tokenInput.value = t
    loadPack()
  }
})

async function loadPack() {
  error.value = ''
  loading.value = true
  try {
    const res = await fetch(`/api/words/${tokenInput.value}`)
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

function addWord() {
  words.value.push({ question: '', answer: '', reading: '' })
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
  tokenInput.value = ''
}

async function savePack() {
  error.value = ''
  saved.value = false
  saving.value = true
  try {
    const res = await fetch(`/api/packs/${tokenInput.value}`, {
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
    const res = await fetch(`/api/packs/${tokenInput.value}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('Failed to delete')
    reset()
  } catch (e: any) {
    error.value = e.message
  }
}
</script>
