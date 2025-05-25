import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { io, Socket } from 'socket.io-client'

export interface DownloadOptions {
  // Basic options
  url: string
  output?: string
  filename?: string
  subfolder: boolean
  force: boolean
  
  // Authentication
  username?: string
  password?: string
  token?: string
  
  // Quality options
  quality?: string
  flexibleQuality?: number
  preferred?: 'dash' | 'hls' | 'http'
  listQuality: boolean
  streamPriority: string[]
  formatPreferred: string[]
  audioLanguage?: string
  videoRole?: string
  resolution?: string
  
  // Subtitle options
  subtitle: boolean
  mergeSubtitle: boolean
  forceSubtitle: boolean
  requireSubtitle: boolean
  allSubtitles: boolean
  rawSubtitles: boolean
  convertSubtitleColors: boolean
  
  // Download options
  live: boolean
  captureTime?: number
  thumbnail: boolean
  getUrl: boolean
  getOnlyEpisodeUrl: boolean
  
  // Advanced options
  silent: boolean
  silentSemi: boolean
  verbose: boolean
  dontVerifySslCert: boolean
  httpHeaders: string[]
  cookies: string[]
  exclude: string[]
  afterDate?: string
  proxy?: string
  
  // Content options
  allEpisodes: boolean
  allLast?: number
  includeClips: boolean
  reverse: boolean
  
  // Output options
  onlyAudio: boolean
  onlyVideo: boolean
  nfo: boolean
  forceNfo: boolean
  
  // Post-processing
  noRemux: boolean
  noMerge: boolean
  noPostprocess: boolean
  keepOriginal: boolean
  outputFormat: 'mp4' | 'mkv'
  chapters: boolean
}

export interface DownloadJob {
  id: string
  url: string
  status: 'pending' | 'downloading' | 'completed' | 'error' | 'cancelled'
  progress: number
  options: DownloadOptions
  output?: string
  error?: string
  startTime?: Date
  endTime?: Date
  logs: string[]
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
    svtplayDlAvailable: false
  })
  
  // Load persisted jobs from localStorage on store initialization
  const loadPersistedJobs = () => {
    try {
      const savedJobs = localStorage.getItem('svtplay-dl-jobs')
      if (savedJobs) {
        const parsedJobs = JSON.parse(savedJobs)
        console.log(`Loading ${parsedJobs.length} persisted jobs from localStorage`)
        // Convert date strings back to Date objects and mark as restored
        jobs.value = parsedJobs.map((job: any) => {
          console.log('Processing job:', job.id, job.status, job.url)
          return {
            ...job,
            progress: typeof job.progress === 'number' ? job.progress : 0,
            startTime: job.startTime ? new Date(job.startTime) : undefined,
            endTime: job.endTime ? new Date(job.endTime) : undefined,
            logs: [...(job.logs || []), 'Job restored from previous session'],
            options: job.options || {},
            status: job.status || 'error'
          }
        })
        console.log('Jobs successfully loaded and restored:', jobs.value.length)
      } else {
        console.log('No persisted jobs found in localStorage')
      }
    } catch (error) {
      console.error('Failed to load persisted jobs:', error)
      jobs.value = []
    }
  }

  // Save jobs to localStorage whenever they change
  const persistJobs = () => {
    try {
      localStorage.setItem('svtplay-dl-jobs', JSON.stringify(jobs.value))
      console.log(`Persisted ${jobs.value.length} jobs to localStorage`)
    } catch (error) {
      console.error('Failed to persist jobs:', error)
    }
  }

  // Watch for changes to jobs array and persist them
  watch(jobs, persistJobs, { deep: true })

  // Load persisted jobs immediately
  loadPersistedJobs()

  // Sync with server to get current status of persisted jobs
  const syncWithServer = () => {
    if (!socket.value?.connected) return
    
    // Request status for all non-completed jobs
    const activeJobIds = jobs.value
      .filter(job => job.status === 'downloading' || job.status === 'pending')
      .map(job => job.id)
    
    if (activeJobIds.length > 0) {
      console.log(`Syncing ${activeJobIds.length} active jobs with server:`, activeJobIds)
      socket.value.emit('sync-downloads', { downloadIds: activeJobIds })
    } else {
      console.log('No active jobs to sync with server')
    }
  }
  
  const currentOptions = ref<DownloadOptions>({
    url: '',
    subfolder: false,
    force: false,
    listQuality: false,
    streamPriority: ['dash', 'hls', 'http'],
    formatPreferred: ['h264'],
    subtitle: false,
    mergeSubtitle: false,
    forceSubtitle: false,
    requireSubtitle: false,
    allSubtitles: false,
    rawSubtitles: false,
    convertSubtitleColors: false,
    live: false,
    thumbnail: false,
    getUrl: false,
    getOnlyEpisodeUrl: false,
    silent: false,
    silentSemi: false,
    verbose: false,
    dontVerifySslCert: false,
    httpHeaders: [],
    cookies: [],
    exclude: [],
    allEpisodes: false,
    includeClips: false,
    reverse: false,
    onlyAudio: false,
    onlyVideo: false,
    nfo: false,
    forceNfo: false,
    noRemux: false,
    noMerge: false,
    noPostprocess: false,
    keepOriginal: false,
    outputFormat: 'mp4',
    chapters: false,
    username: undefined,
    password: undefined,
    token: undefined,
  })

  // Computed properties
  const activeJobs = computed(() => 
    jobs.value.filter((job: DownloadJob) => job.status === 'downloading')
  )
  
  const completedJobs = computed(() => 
    jobs.value.filter((job: DownloadJob) => job.status === 'completed')
  )
  
  const errorJobs = computed(() => 
    jobs.value.filter((job: DownloadJob) => job.status === 'error')
  )

  // Initialize WebSocket connection
  const initializeSocket = () => {
    if (socket.value) return

    socket.value = io('http://localhost:3001', {
      autoConnect: true,
      transports: ['websocket', 'polling']
    })

    // Connection events
    socket.value.on('connect', () => {
      console.log('Connected to WebSocket server')
      serverStatus.value.connected = true
      checkSvtplayDl()
      syncWithServer()
    })

    socket.value.on('disconnect', () => {
      console.log('Disconnected from WebSocket server')
      serverStatus.value.connected = false
    })

    socket.value.on('connect_error', (error) => {
      console.error('WebSocket connection error:', error)
      serverStatus.value.connected = false
      serverStatus.value.error = error.message
    })

    // Download events
    socket.value.on('download-started', (data) => {
      const jobIndex = jobs.value.findIndex((j: DownloadJob) => j.id === data.downloadId)
      if (jobIndex !== -1) {
        const job = jobs.value[jobIndex]
        jobs.value[jobIndex] = {
          ...job,
          status: 'downloading',
          startTime: new Date(),
          logs: [...job.logs, `Started: ${data.command}`]
        }
      }
    })

    socket.value.on('download-progress', (data) => {
      const jobIndex = jobs.value.findIndex((j: DownloadJob) => j.id === data.downloadId)
      if (jobIndex !== -1) {
        const job = jobs.value[jobIndex]
        
        // Create a new job object to ensure reactivity
        const updatedJob = { ...job }
        
        // Update progress if provided by server
        if (data.progress !== null && data.progress !== undefined) {
          updatedJob.progress = Math.min(100, Math.max(0, data.progress))
        }
        
        // Update status if provided
        if (data.status) {
          updatedJob.status = data.status
        }
        
        // Handle log entries - replace progress lines instead of adding new ones
        if (data.chunk) {
          const chunk = data.chunk.trim()
          const newLogs = [...updatedJob.logs]
          
          // Check if this is a progress line (contains [current/total] pattern)
          const isProgressLine = /\[\d+\/\d+\]/.test(chunk)
          
          if (isProgressLine) {
            // Find and replace the last progress line, or add if none exists
            let foundProgressLine = false
            for (let i = newLogs.length - 1; i >= 0; i--) {
              if (/\[\d+\/\d+\]/.test(newLogs[i])) {
                newLogs[i] = chunk // Replace the existing progress line
                foundProgressLine = true
                break
              }
            }
            
            // If no progress line found, add it
            if (!foundProgressLine) {
              newLogs.push(chunk)
            }
          } else {
            // For non-progress lines (INFO messages, errors, etc.), add normally
            newLogs.push(chunk)
          }
          
          updatedJob.logs = newLogs
        }
        
        // Keep logs manageable (last 50 entries)
        if (updatedJob.logs.length > 50) {
          updatedJob.logs = updatedJob.logs.slice(-50)
        }
        
        // Replace the job in the array to trigger reactivity
        jobs.value[jobIndex] = updatedJob
      }
    })

    socket.value.on('download-completed', (data) => {
      const jobIndex = jobs.value.findIndex((j: DownloadJob) => j.id === data.downloadId)
      if (jobIndex !== -1) {
        const job = jobs.value[jobIndex]
        jobs.value[jobIndex] = {
          ...job,
          status: data.success ? 'completed' : 'error',
          progress: data.success ? 100 : job.progress,
          endTime: new Date(),
          output: data.success ? data.output : job.output,
          error: data.success ? job.error : data.error,
          logs: [
            ...job.logs,
            data.success ? 'Download completed successfully' : `Error: ${data.error}`
          ]
        }
      }
    })

    socket.value.on('download-error', (data) => {
      const jobIndex = jobs.value.findIndex((j: DownloadJob) => j.id === data.downloadId)
      if (jobIndex !== -1) {
        const job = jobs.value[jobIndex]
        jobs.value[jobIndex] = {
          ...job,
          status: 'error',
          error: data.error,
          endTime: new Date(),
          logs: [...job.logs, `Error: ${data.error}`]
        }
      }
    })

    socket.value.on('download-cancelled', (data) => {
      const jobIndex = jobs.value.findIndex((j: DownloadJob) => j.id === data.downloadId)
      if (jobIndex !== -1) {
        const job = jobs.value[jobIndex]
        jobs.value[jobIndex] = {
          ...job,
          status: 'cancelled',
          endTime: new Date(),
          logs: [...job.logs, 'Download cancelled']
        }
      }
    })

    // Health and status events
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

    // Sync response from server
    socket.value.on('download-sync', (data) => {
      const { downloadId, status, progress, error } = data
      const jobIndex = jobs.value.findIndex((j: DownloadJob) => j.id === downloadId)
      
      if (jobIndex !== -1) {
        const job = jobs.value[jobIndex]
        jobs.value[jobIndex] = {
          ...job,
          status: status || job.status,
          progress: progress !== undefined ? progress : job.progress,
          error: error || job.error,
          logs: [...job.logs, `Synced with server: ${status}`]
        }
      }
    })

    // Handle case where server doesn't recognize a download ID
    socket.value.on('download-not-found', (data) => {
      const { downloadId } = data
      const jobIndex = jobs.value.findIndex((j: DownloadJob) => j.id === downloadId)
      
      if (jobIndex !== -1) {
        const job = jobs.value[jobIndex]
        // If it was downloading, mark as error since server doesn't know about it
        if (job.status === 'downloading' || job.status === 'pending') {
          jobs.value[jobIndex] = {
            ...job,
            status: 'error',
            error: 'Download not found on server (may have been interrupted)',
            endTime: new Date(),
            logs: [...job.logs, 'Download not found on server - marking as error']
          }
        }
      }
    })
  }

  // Actions
  const addDownloadJob = async (url: string, options: Partial<DownloadOptions> = {}) => {
    if (!socket.value?.connected) {
      throw new Error('Not connected to server')
    }

    const jobId = Date.now().toString()
    const job: DownloadJob = {
      id: jobId,
      url,
      status: 'pending',
      progress: 0,
      options: { ...currentOptions.value, ...options, url },
      startTime: new Date(),
      logs: []
    }
    
    jobs.value.push(job)
    await startDownload(jobId)
  }

  const startDownload = async (jobId: string) => {
    const job = jobs.value.find((j: DownloadJob) => j.id === jobId)
    if (!job || !socket.value?.connected) return

    job.status = 'downloading'
    
    // Build command arguments
    const args = buildCommandArgs(job.options)
    
    // Send download request via WebSocket
    socket.value.emit('start-download', {
      downloadId: jobId,
      url: job.url,
      args: args
    })
  }

  const cancelDownload = (jobId: string) => {
    if (!socket.value?.connected) return
    socket.value.emit('cancel-download', { downloadId: jobId })
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

    // Basic options
    if (options.output) args.push('-o', options.output)
    if (options.filename) args.push('--filename', options.filename)
    if (options.subfolder) args.push('--subfolder')
    if (options.force) args.push('-f')

    // Authentication
    if (options.username) args.push('-u', options.username)
    if (options.password) args.push('-p', options.password)
    if (options.token) args.push('--token', options.token)

    // Quality options
    if (options.quality) args.push('-q', options.quality)
    if (options.flexibleQuality) args.push('-Q', options.flexibleQuality.toString())
    if (options.preferred) args.push('-P', options.preferred)
    if (options.listQuality) args.push('--list-quality')
    if (options.streamPriority.length > 0) args.push('--stream-priority', options.streamPriority.join(','))
    if (options.formatPreferred.length > 0) args.push('--format-preferred', options.formatPreferred.join(','))
    if (options.audioLanguage) args.push('--audio-language', options.audioLanguage)
    if (options.videoRole) args.push('--video-role', options.videoRole)
    if (options.resolution) args.push('--resolution', options.resolution)

    // Subtitle options
    if (options.subtitle) args.push('-S')
    if (options.mergeSubtitle) args.push('-M')
    if (options.forceSubtitle) args.push('--force-subtitle')
    if (options.requireSubtitle) args.push('--require-subtitle')
    if (options.allSubtitles) args.push('--all-subtitles')
    if (options.rawSubtitles) args.push('--raw-subtitles')
    if (options.convertSubtitleColors) args.push('--convert-subtitle-colors')

    // Download options
    if (options.live) args.push('-l')
    if (options.captureTime) args.push('-c', options.captureTime.toString())
    if (options.thumbnail) args.push('-t')
    if (options.getUrl) args.push('-g')
    if (options.getOnlyEpisodeUrl) args.push('--get-only-episode-url')

    // Advanced options
    if (options.silent) args.push('-s')
    if (options.silentSemi) args.push('--silent-semi')
    if (options.verbose) args.push('-v')
    if (options.dontVerifySslCert) args.push('--dont-verify-ssl-cert')
    if (options.httpHeaders.length > 0) args.push('--http-header', options.httpHeaders.join(';'))
    if (options.cookies.length > 0) args.push('--cookies', options.cookies.join(';'))
    if (options.exclude.length > 0) args.push('--exclude', options.exclude.join(','))
    if (options.afterDate) args.push('--after-date', options.afterDate)
    if (options.proxy) args.push('--proxy', options.proxy)

    // Content options
    if (options.allEpisodes) args.push('-A')
    if (options.allLast) args.push('--all-last', options.allLast.toString())
    if (options.includeClips) args.push('--include-clips')
    if (options.reverse) args.push('-R')

    // Output options
    if (options.onlyAudio) args.push('--only-audio')
    if (options.onlyVideo) args.push('--only-video')
    if (options.nfo) args.push('--nfo')
    if (options.forceNfo) args.push('--force-nfo')

    // Post-processing
    if (options.noRemux) args.push('--no-remux')
    if (options.noMerge) args.push('--no-merge')
    if (options.noPostprocess) args.push('--no-postprocess')
    if (options.keepOriginal) args.push('--keep-original')
    if (options.outputFormat === 'mkv') args.push('--output-format', 'mkv')
    if (options.chapters) args.push('--chapters')

    return args
  }

  const removeJob = (jobId: string) => {
    const index = jobs.value.findIndex((j: DownloadJob) => j.id === jobId)
    if (index !== -1) {
      jobs.value.splice(index, 1)
    }
  }

  const clearCompletedJobs = () => {
    jobs.value = jobs.value.filter((job: DownloadJob) => job.status !== 'completed')
  }

  const clearOldJobs = (daysOld: number = 7) => {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - daysOld)
    
    jobs.value = jobs.value.filter((job: DownloadJob) => {
      // Keep active jobs regardless of age
      if (job.status === 'downloading' || job.status === 'pending') {
        return true
      }
      
      // For completed/error jobs, check if they're newer than cutoff
      const jobDate = job.endTime || job.startTime
      return jobDate ? jobDate > cutoffDate : true
    })
  }

  // Auto-cleanup old jobs on store initialization
  clearOldJobs()

  const updateOptions = (newOptions: Partial<DownloadOptions>) => {
    Object.assign(currentOptions.value, newOptions)
  }

  const disconnect = () => {
    if (socket.value) {
      socket.value.disconnect()
      socket.value = null
    }
  }

  const clearAllData = () => {
    jobs.value = []
    localStorage.removeItem('svtplay-dl-jobs')
  }

  // Auto-initialize socket when store is created
  initializeSocket()

  return {
    socket,
    jobs,
    currentOptions,
    serverStatus,
    activeJobs,
    completedJobs,
    errorJobs,
    initializeSocket,
    addDownloadJob,
    startDownload,
    cancelDownload,
    removeJob,
    clearCompletedJobs,
    clearOldJobs,
    clearAllData,
    updateOptions,
    buildCommandArgs,
    checkSvtplayDl,
    healthCheck,
    disconnect,
    loadPersistedJobs,
    persistJobs,
    syncWithServer,
  }
})
