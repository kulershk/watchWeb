<template>
  <div class="min-h-screen bg-bg">
    <nav class="border-b border-border bg-surface">
      <div class="max-w-3xl mx-auto px-4 py-3 flex items-center gap-6">
        <router-link to="/" class="text-lg font-bold text-primary">Watch Words</router-link>
        <router-link to="/create" class="text-text-muted hover:text-text transition-colors text-sm">Create</router-link>
        <router-link to="/edit" class="text-text-muted hover:text-text transition-colors text-sm">Edit</router-link>
      </div>
    </nav>
    <main class="max-w-3xl mx-auto px-4 py-8">
      <router-view />
    </main>
  </div>
</template>
