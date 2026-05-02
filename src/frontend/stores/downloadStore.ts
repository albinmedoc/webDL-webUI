import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { io, Socket } from 'socket.io-client'

export interface DownloadOptions {
  url: string

  username?: string
  password?: string
  token?: string

  // Single resolution height (e.g. 1080). Undefined → "best available".
  // Multi-resolution selections are fanned out into separate jobs at submit
  // time; each job carries one height.
  resolution?: number

  allEpisodes: boolean

  // Usenet auto-post (only honored when backend has USENET_ENABLED=true).
  // Newznab category (5020 TV/Foreign, 2010 Movies/Foreign) is auto-detected
  // server-side from the filename — no UI input needed.
  autoPostUsenet?: boolean
}

export interface ProbeState {
  url: string | null
  loading: boolean
  heights: number[] | null
  error: string | null
}

export interface DownloadFile {
  path: string
  size: number
}

export type DownloadStatus = 'pending' | 'downloading' | 'completed' | 'error' | 'cancelled'

export interface DownloadJob {
  id: string
  url: string
  status: DownloadStatus
  progress: number
  resolution: number | null
  allEpisodes: boolean
  autoPostUsenet: boolean
  output: string | null
  error: string | null
  outputDir: string | null
  files: DownloadFile[]
  logs: string[]
  startTime: number | null
  endTime: number | null
  createdAt: number
  updatedAt: number
}

export interface ServerStatus {
  connected: boolean
  svtplayDlAvailable: boolean
  svtplayDlVersion?: string
  error?: string
}

export const useDownloadStore = defineStore('download', () => {
  const socket = ref<Socket | null>(null)
  const jobs = ref<DownloadJob[]>([])
  const serverStatus = ref<ServerStatus>({
    connected: false,
    svtplayDlAvailable: false,
  })

  const sortJobs = (list: DownloadJob[]): DownloadJob[] =>
    [...list].sort((a, b) => b.createdAt - a.createdAt)

  const upsertJob = (job: DownloadJob) => {
    const idx = jobs.value.findIndex((j) => j.id === job.id)
    if (idx === -1) {
      jobs.value = sortJobs([job, ...jobs.value])
    } else {
      const next = [...jobs.value]
      next[idx] = job
      jobs.value = next
    }
  }

  const removeJobLocally = (id: string) => {
    const idx = jobs.value.findIndex((j) => j.id === id)
    if (idx !== -1) jobs.value.splice(idx, 1)
  }

  const syncWithServer = () => {
    if (!socket.value?.connected) return
    socket.value.emit('sync-downloads')
  }

  const currentOptions = ref<DownloadOptions>({
    url: '',
    allEpisodes: false,
    username: undefined,
    password: undefined,
    token: undefined,
    autoPostUsenet: false,
  })

  // Quality probe state — last probed URL, available heights, loading flag.
  // Reset whenever the user types a new URL.
  const probe = ref<ProbeState>({
    url: null,
    loading: false,
    heights: null,
    error: null,
  })

  // Heights the user ticked in the form. Fanned out into N jobs on submit;
  // empty array → single "best available" job.
  const selectedResolutions = ref<number[]>([])

  const activeJobs = computed(() =>
    jobs.value.filter((job) => job.status === 'downloading'),
  )

  const completedJobs = computed(() =>
    jobs.value.filter((job) => job.status === 'completed'),
  )

  const errorJobs = computed(() =>
    jobs.value.filter((job) => job.status === 'error'),
  )

  const initializeSocket = () => {
    if (socket.value) return

    socket.value = io({
      autoConnect: true,
      transports: ['websocket', 'polling'],
    })

    socket.value.on('connect', () => {
      serverStatus.value.connected = true
      checkSvtplayDl()
      syncWithServer()
    })

    socket.value.on('disconnect', () => {
      serverStatus.value.connected = false
    })

    socket.value.on('connect_error', (error) => {
      serverStatus.value.connected = false
      serverStatus.value.error = error.message
    })

    socket.value.on('download-jobs-sync', (data: { jobs: DownloadJob[] }) => {
      jobs.value = sortJobs(data.jobs ?? [])
    })

    socket.value.on('download-job-upserted', (data: { job: DownloadJob }) => {
      if (data?.job) upsertJob(data.job)
    })

    socket.value.on('download-job-deleted', (data: { id: string }) => {
      if (data?.id) removeJobLocally(data.id)
    })

    socket.value.on('download-error', (data: { error: string }) => {
      console.error('Download validation error', data)
    })

    socket.value.on('health-status', (data) => {
      console.log('Server health:', data)
    })

    socket.value.on('svtplay-dl-status', (data) => {
      serverStatus.value.svtplayDlAvailable = data.available
      if (data.available) {
        serverStatus.value.svtplayDlVersion = data.version
        serverStatus.value.error = undefined
      } else {
        serverStatus.value.error = data.error
      }
    })
  }

  const addDownloadJob = async (url: string, options: Partial<DownloadOptions> = {}) => {
    if (!socket.value?.connected) {
      throw new Error('Not connected to server')
    }

    const resolutions: (number | undefined)[] = selectedResolutions.value.length > 0
      ? [...selectedResolutions.value]
      : [undefined]

    for (const resolution of resolutions) {
      const merged: DownloadOptions = {
        ...currentOptions.value,
        ...options,
        url,
        resolution,
      }
      const args = buildCommandArgs(merged)
      socket.value.emit('start-download', {
        url,
        args,
        autoPostUsenet: !!merged.autoPostUsenet,
        options: {
          resolution: resolution ?? null,
          allEpisodes: merged.allEpisodes,
          autoPostUsenet: !!merged.autoPostUsenet,
        },
      })
    }
  }

  const probeUrl = async (url: string): Promise<void> => {
    if (!url) return
    if (probe.value.url === url && probe.value.heights !== null) return
    probe.value = { url, loading: true, heights: null, error: null }
    try {
      const res = await fetch(`/api/probe?url=${encodeURIComponent(url)}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        probe.value = { url, loading: false, heights: null, error: body.error || 'Probe failed' }
        return
      }
      const body = (await res.json()) as { heights: number[] }
      probe.value = { url, loading: false, heights: body.heights, error: null }
      selectedResolutions.value = selectedResolutions.value.filter((h) =>
        body.heights.includes(h),
      )
    } catch (err) {
      probe.value = {
        url,
        loading: false,
        heights: null,
        error: (err as Error).message || 'Probe failed',
      }
    }
  }

  const resetProbe = () => {
    probe.value = { url: null, loading: false, heights: null, error: null }
    selectedResolutions.value = []
  }

  const cancelDownload = (jobId: string) => {
    if (!socket.value?.connected) return
    socket.value.emit('cancel-download', { downloadId: jobId })
  }

  // Manually enqueue a Usenet upload for an already-downloaded file. Mirrors
  // auto-post: the backend applies release naming and detects the Newznab
  // category from the filename when applyNaming=true.
  const postToUsenet = (jobId: string, filePath: string) => {
    if (!socket.value?.connected) return
    const job = jobs.value.find((j) => j.id === jobId)
    const quality = job?.resolution
    socket.value.emit('start-usenet-upload', {
      mediaPath: filePath,
      downloadId: jobId,
      quality: quality !== null && quality !== undefined ? String(quality) : null,
      applyNaming: true,
    })
  }

  const checkSvtplayDl = () => {
    if (!socket.value?.connected) return
    socket.value.emit('check-svtplay-dl')
  }

  const healthCheck = () => {
    if (!socket.value?.connected) return
    socket.value.emit('health-check')
  }

  const buildCommandArgs = (options: DownloadOptions): string[] => {
    const args: string[] = []

    if (options.username) args.push('-u', options.username)
    if (options.password) args.push('-p', options.password)
    if (options.token) args.push('--token', options.token)

    if (options.resolution !== undefined) {
      args.push('--resolution', String(options.resolution))
    }

    args.push('--subfolder', '-S', '-M', '--output-format', 'mkv')

    if (options.allEpisodes) args.push('-A')

    return args
  }

  const removeJob = (jobId: string) => {
    if (!socket.value?.connected) return
    socket.value.emit('remove-download-job', { downloadId: jobId })
  }

  const clearCompletedJobs = () => {
    if (!socket.value?.connected) return
    socket.value.emit('clear-completed-downloads')
  }

  const clearOldJobs = (daysOld: number = 7) => {
    if (!socket.value?.connected) return
    socket.value.emit('clear-old-downloads', { daysOld })
  }

  const clearAllData = () => {
    if (!socket.value?.connected) return
    socket.value.emit('clear-all-downloads')
  }

  const updateOptions = (newOptions: Partial<DownloadOptions>) => {
    Object.assign(currentOptions.value, newOptions)
  }

  const disconnect = () => {
    if (socket.value) {
      socket.value.disconnect()
      socket.value = null
    }
  }

  initializeSocket()

  return {
    socket,
    jobs,
    currentOptions,
    serverStatus,
    probe,
    selectedResolutions,
    activeJobs,
    completedJobs,
    errorJobs,
    initializeSocket,
    addDownloadJob,
    cancelDownload,
    postToUsenet,
    removeJob,
    clearCompletedJobs,
    clearOldJobs,
    clearAllData,
    updateOptions,
    buildCommandArgs,
    probeUrl,
    resetProbe,
    checkSvtplayDl,
    healthCheck,
    disconnect,
    syncWithServer,
  }
})
