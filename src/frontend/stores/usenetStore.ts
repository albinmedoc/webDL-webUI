import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { useDownloadStore } from './downloadStore'

export type UsenetState =
  | 'queued'
  | 'archiving'
  | 'par2'
  | 'posting'
  | 'posted'
  | 'indexing'
  | 'done'
  | 'failed'
  | 'cancelled'

export const NON_TERMINAL_STATES: UsenetState[] = [
  'queued',
  'archiving',
  'par2',
  'posting',
  'posted',
  'indexing',
]

export interface UsenetJobSummary {
  id: string
  downloadId: string | null
  mediaPath: string
  mediaSizeBytes: number
  state: UsenetState
  failureState: UsenetState | null
  progress: number
  nzbPath: string | null
  error: string | null
  indexerResponse: string | null
  category: string | null
  createdAt: number
  updatedAt: number
}

export interface UsenetJob extends UsenetJobSummary {
  logs: string[]
}

export interface ToolAvailability {
  rar: boolean
  parpar: boolean
  nyuu: boolean
}

const LOG_LIMIT = 200

export const useUsenetStore = defineStore('usenet', () => {
  const downloadStore = useDownloadStore()
  const jobs = ref<UsenetJob[]>([])
  const enabled = ref<boolean | null>(null)
  const lastError = ref<string | null>(null)
  const wired = ref(false)
  const tools = ref<ToolAvailability | null>(null)
  const toolsError = ref<string | null>(null)
  const toolsLoading = ref(false)

  function findIndex(jobId: string): number {
    return jobs.value.findIndex((j) => j.id === jobId)
  }

  function upsert(summary: UsenetJobSummary, log?: string): void {
    const idx = findIndex(summary.id)
    if (idx === -1) {
      jobs.value.unshift({ ...summary, logs: log ? [log] : [] })
    } else {
      const existing = jobs.value[idx]
      const logs = log ? [...existing.logs, log].slice(-LOG_LIMIT) : existing.logs
      jobs.value[idx] = { ...existing, ...summary, logs }
    }
  }

  function patch(jobId: string, fields: Partial<UsenetJob>, log?: string): void {
    const idx = findIndex(jobId)
    if (idx === -1) return
    const existing = jobs.value[idx]
    const logs = log ? [...existing.logs, log].slice(-LOG_LIMIT) : existing.logs
    jobs.value[idx] = { ...existing, ...fields, logs }
  }

  function fetchHealth(): void {
    fetch('/api/health')
      .then((r) => r.json())
      .then((data) => {
        enabled.value = !!data.usenetEnabled
      })
      .catch(() => {
        enabled.value = false
      })
  }

  async function fetchTools(force = false): Promise<void> {
    if (!force && tools.value) return
    toolsLoading.value = true
    toolsError.value = null
    try {
      const res = await fetch('/api/usenet/tools')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      tools.value = await res.json()
    } catch (err) {
      toolsError.value = (err as Error).message
    } finally {
      toolsLoading.value = false
    }
  }

  function attachSocket(): void {
    if (wired.value) return
    const socket = downloadStore.socket
    if (!socket) return

    socket.on('usenet-enqueued', (data: { job: UsenetJobSummary }) => {
      upsert(data.job, 'Job enqueued')
    })

    socket.on(
      'usenet-state-changed',
      (data: {
        jobId: string
        state: UsenetState
        failureState?: UsenetState | null
        error?: string | null
      }) => {
        patch(
          data.jobId,
          {
            state: data.state,
            failureState: data.failureState ?? null,
            error: data.error ?? null,
            updatedAt: Date.now(),
          },
          `State → ${data.state}${data.error ? ` (${data.error})` : ''}`,
        )
      },
    )

    socket.on('usenet-progress', (data: { jobId: string; progress: number }) => {
      patch(data.jobId, { progress: data.progress, updatedAt: Date.now() })
    })

    socket.on('usenet-log', (data: { jobId: string; line: string }) => {
      patch(data.jobId, { updatedAt: Date.now() }, data.line)
    })

    socket.on('usenet-completed', (data: { jobId: string; job: UsenetJobSummary | null }) => {
      if (data.job) upsert(data.job, 'Completed')
    })

    socket.on('usenet-sync', (data: { jobs: UsenetJobSummary[] }) => {
      jobs.value = data.jobs
        .map((summary) => {
          const existing = jobs.value.find((j) => j.id === summary.id)
          return { ...summary, logs: existing?.logs ?? [] }
        })
        .sort((a, b) => b.createdAt - a.createdAt)
    })

    socket.on('usenet-error', (data: { jobId?: string; error: string }) => {
      lastError.value = data.error
      if (data.jobId) {
        patch(data.jobId, { error: data.error, updatedAt: Date.now() }, `Error: ${data.error}`)
      }
    })

    wired.value = true
  }

  function syncWithServer(): void {
    const socket = downloadStore.socket
    if (!socket?.connected) return
    socket.emit('sync-usenet-uploads')
  }

  // Wire up once a socket exists, and re-sync on (re)connect.
  watch(
    () => downloadStore.socket,
    (sock) => {
      if (!sock) return
      attachSocket()
      sock.on('connect', () => {
        if (enabled.value !== false) syncWithServer()
      })
    },
    { immediate: true },
  )

  watch(
    () => downloadStore.serverStatus.connected,
    (connected) => {
      if (connected && enabled.value !== false) syncWithServer()
    },
  )

  function cancel(jobId: string): void {
    downloadStore.socket?.emit('cancel-usenet-upload', { jobId })
  }

  function retry(jobId: string): void {
    downloadStore.socket?.emit('retry-usenet-upload', { jobId })
  }

  function clearError(): void {
    lastError.value = null
  }

  const activeJobs = computed(() =>
    jobs.value.filter((j) => NON_TERMINAL_STATES.includes(j.state)),
  )
  const completedJobs = computed(() => jobs.value.filter((j) => j.state === 'done'))
  const failedJobs = computed(() => jobs.value.filter((j) => j.state === 'failed'))

  fetchHealth()

  return {
    jobs,
    enabled,
    lastError,
    tools,
    toolsError,
    toolsLoading,
    activeJobs,
    completedJobs,
    failedJobs,
    fetchHealth,
    fetchTools,
    syncWithServer,
    cancel,
    retry,
    clearError,
  }
})
