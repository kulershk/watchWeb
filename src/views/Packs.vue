<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold">All Packs</h1>
      <router-link to="/create"
        class="bg-primary hover:bg-primary-hover text-bg text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
        + New Pack
      </router-link>
    </div>

    <p v-if="loading" class="text-text-muted">Loading...</p>
    <p v-else-if="error" class="text-danger text-sm">{{ error }}</p>
    <p v-else-if="packs.length === 0" class="text-text-muted">No packs yet. Create one!</p>

    <div v-else class="space-y-2">
      <router-link v-for="pack in packs" :key="pack.token" :to="'/edit/' + pack.token"
        class="flex items-center justify-between bg-surface hover:bg-surface-light border border-border rounded-lg p-4 transition-colors">
        <div class="flex items-center gap-4">
          <span class="font-mono text-accent font-bold text-lg tracking-widest">{{ pack.token }}</span>
          <span class="text-text-muted text-sm">{{ pack.word_count }} words</span>
        </div>
        <span class="text-text-muted text-xs">{{ formatDate(pack.created_at) }}</span>
      </router-link>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

interface Pack {
  token: string
  created_at: string
  word_count: number
}

const packs = ref<Pack[]>([])
const loading = ref(true)
const error = ref('')

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString()
}

onMounted(async () => {
  try {
    const res = await fetch('/api/packs')
    if (!res.ok) throw new Error('Failed to load packs')
    packs.value = await res.json()
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
})
</script>
