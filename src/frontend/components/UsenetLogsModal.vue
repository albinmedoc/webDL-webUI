<template>
  <Teleport to="body">
    <div class="modal-backdrop-custom" @click.self="$emit('close')">
      <div class="modal-dialog-custom card shadow-lg">
        <div class="card-header bg-dark text-white d-flex justify-content-between align-items-center gap-2">
          <div class="d-flex flex-column min-w-0">
            <div class="fw-semibold">
              <i class="bi bi-terminal me-2"></i>
              Usenet upload logs
              <span
                v-if="job"
                class="badge ms-2"
                :class="badgeClass(job.state)"
              >
                {{ job.state }}
              </span>
              <span v-if="job?.failureState" class="badge bg-light text-dark border ms-1">
                failed in {{ job.failureState }}
              </span>
            </div>
            <small class="text-truncate text-light-emphasis" :title="job?.mediaPath ?? ''">
              {{ basename(job?.mediaPath) || '—' }}
            </small>
          </div>
          <button
            type="button"
            class="btn-close btn-close-white flex-shrink-0"
            @click="$emit('close')"
            aria-label="Close"
          ></button>
        </div>

        <div
          ref="logContainer"
          class="card-body bg-black text-success font-monospace small"
          style="height: 70vh; overflow-y: auto; overflow-x: auto; white-space: pre;"
        >
          <div v-if="!logs" class="text-muted">Job not found.</div>
          <div v-else-if="logs.length === 0" class="text-muted">No logs yet…</div>
          <div v-else>
            <div v-for="(line, idx) in logs" :key="idx">{{ line }}</div>
          </div>
        </div>

        <div class="card-footer d-flex justify-content-between align-items-center gap-2 small text-muted">
          <span>
            <i class="bi bi-info-circle me-1"></i>
            Showing the last {{ logs?.length ?? 0 }} log line(s); updates live.
          </span>
          <button class="btn btn-sm btn-outline-secondary" @click="$emit('close')">
            Close
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useUsenetStore, type UsenetState } from '../stores/usenetStore'

const props = defineProps<{
  jobId: string
  // Optional logs override (used by history view, where the job isn't in the live store).
  logsOverride?: string[]
  mediaPath?: string
  state?: UsenetState
  failureState?: UsenetState | null
}>()
defineEmits<{ close: [] }>()

const usenetStore = useUsenetStore()
const liveJob = computed(() => usenetStore.jobs.find((j) => j.id === props.jobId))
const job = computed(() => {
  if (liveJob.value) return liveJob.value
  if (!props.mediaPath || !props.state) return null
  return {
    state: props.state,
    failureState: props.failureState ?? null,
    mediaPath: props.mediaPath,
  }
})
const logs = computed<string[] | null>(() => {
  if (liveJob.value) return liveJob.value.logs
  return props.logsOverride ?? null
})
const logContainer = ref<HTMLDivElement | null>(null)

const isAtBottom = ref(true)

function recordScrollPosition(): void {
  const el = logContainer.value
  if (!el) return
  const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
  isAtBottom.value = distanceFromBottom < 24
}

function scrollToBottom(): void {
  nextTick(() => {
    const el = logContainer.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

watch(
  () => logs.value?.length ?? 0,
  () => {
    if (isAtBottom.value) scrollToBottom()
  },
)

onMounted(() => {
  scrollToBottom()
  logContainer.value?.addEventListener('scroll', recordScrollPosition)
})

function basename(p: string | null | undefined): string {
  if (!p) return ''
  const parts = p.split(/[\\/]/)
  return parts[parts.length - 1] || p
}

function badgeClass(state: UsenetState): string {
  switch (state) {
    case 'queued':
      return 'bg-secondary'
    case 'archiving':
    case 'par2':
      return 'bg-info'
    case 'posting':
    case 'posted':
      return 'bg-primary'
    case 'indexing':
      return 'bg-warning text-dark'
    case 'done':
      return 'bg-success'
    case 'failed':
      return 'bg-danger'
    case 'cancelled':
      return 'bg-dark'
  }
}
</script>

<style scoped>
.modal-backdrop-custom {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 1055;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}
.modal-dialog-custom {
  width: min(960px, 100%);
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}
</style>
