<template>
  <div class="flex items-center gap-2 min-h-[36px]">
    <label class="text-xs text-text-muted shrink-0">Audio</label>

    <!-- Has audio: show waveform + controls -->
    <template v-if="modelValue">
      <div class="flex items-center gap-2 flex-1 bg-bg border border-border rounded px-2 py-1.5">
        <button type="button" @click="togglePlay"
          class="shrink-0 w-6 h-6 flex items-center justify-center rounded-full bg-accent/20 text-accent hover:bg-accent/30 transition-colors">
          <svg v-if="!playing" class="w-3 h-3 ml-0.5" viewBox="0 0 16 16" fill="currentColor"><polygon points="3,1 13,8 3,15"/></svg>
          <svg v-else class="w-3 h-3" viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="2" width="4" height="12"/><rect x="10" y="2" width="4" height="12"/></svg>
        </button>
        <div class="flex-1 relative h-6 cursor-pointer" @click="seek">
          <canvas ref="waveCanvas" class="w-full h-full rounded" />
          <div class="absolute top-0 left-0 h-full bg-accent/20 rounded pointer-events-none" :style="{ width: progressPct + '%' }" />
        </div>
        <span class="text-xs text-text-muted font-mono shrink-0">{{ formatTime(playing ? currentTime : duration) }}</span>
        <button type="button" @click="$emit('remove')"
          class="shrink-0 text-danger hover:text-red-300 transition-colors">
          <svg class="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor"><path d="M4.5 3L8 6.5 11.5 3 13 4.5 9.5 8 13 11.5 11.5 13 8 9.5 4.5 13 3 11.5 6.5 8 3 4.5z"/></svg>
        </button>
      </div>
    </template>

    <!-- Recording: show live waveform -->
    <template v-else-if="recording">
      <div class="flex items-center gap-2 flex-1 bg-bg border border-danger/50 rounded px-2 py-1.5">
        <div class="shrink-0 w-2.5 h-2.5 rounded-full bg-danger animate-pulse" />
        <div class="flex-1 h-6">
          <canvas ref="liveCanvas" class="w-full h-full rounded" />
        </div>
        <span class="text-xs text-text-muted font-mono shrink-0">{{ formatTime(recTime) }}</span>
        <button type="button" @click="stopRecording"
          class="shrink-0 w-6 h-6 flex items-center justify-center rounded-full bg-danger text-bg hover:bg-red-400 transition-colors">
          <svg class="w-3 h-3" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="1"/></svg>
        </button>
      </div>
    </template>

    <!-- No audio: show record button -->
    <template v-else>
      <button type="button" @click="startRecording"
        class="flex items-center gap-1.5 text-xs bg-surface-light hover:bg-border text-text-muted hover:text-text border border-border px-2.5 py-1.5 rounded transition-colors">
        <svg class="w-3 h-3 text-danger" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="5"/></svg>
        Record
      </button>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onBeforeUnmount, nextTick } from 'vue'

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void
  (e: 'remove'): void
  (e: 'error', msg: string): void
}>()

const recording = ref(false)
const recTime = ref(0)
const playing = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const progressPct = ref(0)

const waveCanvas = ref<HTMLCanvasElement | null>(null)
const liveCanvas = ref<HTMLCanvasElement | null>(null)

let mediaRecorder: MediaRecorder | null = null
let audioCtx: AudioContext | null = null
let analyser: AnalyserNode | null = null
let liveAnimFrame = 0
let recTimer: ReturnType<typeof setInterval> | null = null
let audioEl: HTMLAudioElement | null = null
let storedWaveform: number[] = []

function formatTime(s: number) {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

// --- Live recording waveform ---
function drawLiveWaveform() {
  if (!analyser || !liveCanvas.value) return
  const canvas = liveCanvas.value
  const ctx = canvas.getContext('2d')!
  const dpr = window.devicePixelRatio || 1
  canvas.width = canvas.offsetWidth * dpr
  canvas.height = canvas.offsetHeight * dpr
  ctx.scale(dpr, dpr)
  const w = canvas.offsetWidth
  const h = canvas.offsetHeight

  const data = new Uint8Array(analyser.frequencyBinCount)
  analyser.getByteTimeDomainData(data)

  ctx.clearRect(0, 0, w, h)
  ctx.strokeStyle = '#ef4444'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  const sliceW = w / data.length
  for (let i = 0; i < data.length; i++) {
    const v = data[i] / 128.0
    const y = (v * h) / 2
    if (i === 0) ctx.moveTo(0, y)
    else ctx.lineTo(i * sliceW, y)
  }
  ctx.stroke()
  liveAnimFrame = requestAnimationFrame(drawLiveWaveform)
}

async function trimStart(blob: Blob, seconds: number): Promise<Blob> {
  try {
    const ctx = new AudioContext()
    const arrayBuf = await blob.arrayBuffer()
    const audioBuf = await ctx.decodeAudioData(arrayBuf)
    const trimSamples = Math.min(Math.floor(seconds * audioBuf.sampleRate), audioBuf.length)
    const newLength = audioBuf.length - trimSamples
    if (newLength <= 0) { ctx.close(); return blob }
    const trimmed = ctx.createBuffer(audioBuf.numberOfChannels, newLength, audioBuf.sampleRate)
    for (let ch = 0; ch < audioBuf.numberOfChannels; ch++) {
      const src = audioBuf.getChannelData(ch)
      trimmed.copyToChannel(src.slice(trimSamples), ch)
    }
    // Render trimmed buffer to WAV blob
    const wavBlob = audioBufferToWav(trimmed)
    ctx.close()
    return wavBlob
  } catch {
    return blob
  }
}

function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numCh = buffer.numberOfChannels
  const sampleRate = buffer.sampleRate
  const format = 1 // PCM
  const bitDepth = 16
  const bytesPerSample = bitDepth / 8
  const blockAlign = numCh * bytesPerSample
  const dataLength = buffer.length * blockAlign
  const headerLength = 44
  const arrayBuffer = new ArrayBuffer(headerLength + dataLength)
  const view = new DataView(arrayBuffer)

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, format, true)
  view.setUint16(22, numCh, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitDepth, true)
  writeString(36, 'data')
  view.setUint32(40, dataLength, true)

  let offset = 44
  const channels: Float32Array[] = []
  for (let ch = 0; ch < numCh; ch++) channels.push(buffer.getChannelData(ch))
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i]))
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true)
      offset += 2
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' })
}

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: 48000, channelCount: 1 },
    })
    const chunks: Blob[] = []

    audioCtx = new AudioContext({ sampleRate: 48000 })
    const source = audioCtx.createMediaStreamSource(stream)
    analyser = audioCtx.createAnalyser()
    analyser.fftSize = 2048
    source.connect(analyser)

    mediaRecorder = new MediaRecorder(stream, {
      audioBitsPerSecond: 128000,
    })
    mediaRecorder.ondataavailable = (e) => chunks.push(e.data)
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop())
      if (audioCtx) { audioCtx.close(); audioCtx = null }
      cancelAnimationFrame(liveAnimFrame)

      const blob = new Blob(chunks, { type: mediaRecorder!.mimeType })
      // Trim leading noise suppression ramp-up (~300ms)
      const trimmedBlob = await trimStart(blob, 0.3)
      // Decode waveform for display
      await decodeWaveform(trimmedBlob)

      const reader = new FileReader()
      reader.onloadend = async () => {
        const res = await fetch('/api/audio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: reader.result as string }),
        })
        if (res.ok) {
          const { filename } = await res.json()
          emit('update:modelValue', filename)
        } else {
          emit('error', 'Failed to upload audio')
        }
        recording.value = false
      }
      reader.readAsDataURL(trimmedBlob)
    }

    mediaRecorder.start()
    recording.value = true
    recTime.value = 0
    recTimer = setInterval(() => recTime.value++, 1000)

    await nextTick()
    drawLiveWaveform()
  } catch {
    emit('error', 'Microphone access denied')
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop()
  }
  if (recTimer) { clearInterval(recTimer); recTimer = null }
}

// --- Static waveform from audio file ---
async function decodeWaveform(blob: Blob) {
  try {
    const arrBuf = await blob.arrayBuffer()
    const ctx = new AudioContext()
    const audioBuf = await ctx.decodeAudioData(arrBuf)
    duration.value = audioBuf.duration
    const raw = audioBuf.getChannelData(0)
    const bars = 80
    const blockSize = Math.floor(raw.length / bars)
    storedWaveform = []
    for (let i = 0; i < bars; i++) {
      let sum = 0
      for (let j = 0; j < blockSize; j++) {
        sum += Math.abs(raw[i * blockSize + j])
      }
      storedWaveform.push(sum / blockSize)
    }
    const max = Math.max(...storedWaveform, 0.01)
    storedWaveform = storedWaveform.map(v => v / max)
    ctx.close()
  } catch {
    storedWaveform = []
    duration.value = 0
  }
}

function drawStaticWaveform() {
  if (!waveCanvas.value || storedWaveform.length === 0) return
  const canvas = waveCanvas.value
  const ctx = canvas.getContext('2d')!
  const dpr = window.devicePixelRatio || 1
  canvas.width = canvas.offsetWidth * dpr
  canvas.height = canvas.offsetHeight * dpr
  ctx.scale(dpr, dpr)
  const w = canvas.offsetWidth
  const h = canvas.offsetHeight
  const bars = storedWaveform.length
  const barW = w / bars
  const gap = Math.max(1, barW * 0.2)

  ctx.clearRect(0, 0, w, h)
  for (let i = 0; i < bars; i++) {
    const barH = Math.max(2, storedWaveform[i] * h * 0.9)
    const x = i * barW
    const y = (h - barH) / 2
    const pct = (i / bars) * 100
    ctx.fillStyle = pct < progressPct.value ? '#6ee7b7' : '#4b5563'
    ctx.fillRect(x + gap / 2, y, barW - gap, barH)
  }
}

// Load waveform when filename changes (for existing audio loaded from server)
watch(() => props.modelValue, async (filename) => {
  if (filename && storedWaveform.length === 0) {
    try {
      const res = await fetch(`/api/audio/${filename}`)
      if (res.ok) {
        const blob = await res.blob()
        await decodeWaveform(blob)
        await nextTick()
        drawStaticWaveform()
      }
    } catch { /* ignore */ }
  }
  if (!filename) {
    storedWaveform = []
    duration.value = 0
  }
}, { immediate: true })

// Redraw waveform when canvas becomes available or progress changes
watch([waveCanvas, progressPct], () => {
  drawStaticWaveform()
})

// --- Playback ---
function togglePlay() {
  if (!props.modelValue) return
  if (playing.value && audioEl) {
    audioEl.pause()
    playing.value = false
    return
  }
  audioEl = new Audio(`/api/audio/${props.modelValue}`)
  audioEl.ontimeupdate = () => {
    currentTime.value = audioEl!.currentTime
    progressPct.value = duration.value ? (audioEl!.currentTime / duration.value) * 100 : 0
    drawStaticWaveform()
  }
  audioEl.onended = () => {
    playing.value = false
    progressPct.value = 0
    currentTime.value = 0
    drawStaticWaveform()
  }
  audioEl.play()
  playing.value = true
}

function seek(e: MouseEvent) {
  if (!audioEl || !duration.value) return
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const pct = (e.clientX - rect.left) / rect.width
  audioEl.currentTime = pct * duration.value
  if (!playing.value) togglePlay()
}

onBeforeUnmount(() => {
  if (audioEl) { audioEl.pause(); audioEl = null }
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop()
  if (recTimer) clearInterval(recTimer)
  cancelAnimationFrame(liveAnimFrame)
  if (audioCtx) audioCtx.close()
})
</script>
