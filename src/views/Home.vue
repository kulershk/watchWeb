<template>
  <div class="space-y-8">
    <div class="text-center space-y-4">
      <h1 class="text-3xl font-bold text-text">Learn Words on Your Watch</h1>
      <p class="text-text-muted max-w-lg mx-auto">
        Create custom word packs and download them to your Wear OS watch.
        Perfect for learning vocabulary on the go.
      </p>
    </div>

    <div class="grid gap-4 sm:grid-cols-3">
      <div class="bg-surface rounded-lg p-5 border border-border">
        <div class="text-2xl mb-2">1.</div>
        <h3 class="font-semibold mb-1">Create a Pack</h3>
        <p class="text-sm text-text-muted">Add words with questions, answers, and optional readings.</p>
      </div>
      <div class="bg-surface rounded-lg p-5 border border-border">
        <div class="text-2xl mb-2">2.</div>
        <h3 class="font-semibold mb-1">Get a Token</h3>
        <p class="text-sm text-text-muted">You'll receive a 4-digit code to enter on your watch.</p>
      </div>
      <div class="bg-surface rounded-lg p-5 border border-border">
        <div class="text-2xl mb-2">3.</div>
        <h3 class="font-semibold mb-1">Download & Learn</h3>
        <p class="text-sm text-text-muted">Enter the code on your watch to download the word pack.</p>
      </div>
    </div>

    <div class="bg-surface rounded-lg p-6 border border-border">
      <h2 class="font-semibold mb-3">Word Pack Format</h2>
      <p class="text-sm text-text-muted mb-3">Each word has three fields:</p>
      <ul class="text-sm text-text-muted space-y-1">
        <li><span class="text-primary font-medium">question</span> — shown on screen (what you're quizzed on)</li>
        <li><span class="text-primary font-medium">answer</span> — revealed when you tap "Show Answer"</li>
        <li><span class="text-primary font-medium">reading</span> — optional hint shown under the question</li>
      </ul>
    </div>

    <div class="flex gap-3 justify-center">
      <router-link to="/create"
        class="bg-primary hover:bg-primary-hover text-bg font-semibold px-6 py-2.5 rounded-lg transition-colors">
        Create Word Pack
      </router-link>
      <router-link to="/edit"
        class="bg-surface-light hover:bg-border text-text font-medium px-6 py-2.5 rounded-lg border border-border transition-colors">
        Edit Existing
      </router-link>
    </div>
  </div>
</template>
