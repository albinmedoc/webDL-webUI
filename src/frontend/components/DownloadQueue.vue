<template>
  <div class="card shadow-sm h-100">
    <div class="card-header bg-success text-white d-flex justify-content-between align-items-center">
      <h5 class="card-title mb-0">
        <i class="bi bi-list-task me-2"></i>
        Download Queue
        <small v-if="hasPersistedJobs" class="ms-2 badge bg-light text-success">
          <i class="bi bi-save me-1"></i>
          Persistent
        </small>
      </h5>
      <div class="d-flex gap-2">
        <button
          v-if="downloadStore.completedJobs.length > 0"
          @click="downloadStore.clearCompletedJobs()"
          class="btn btn-outline-light btn-sm"
        >
          <i class="bi bi-trash me-1"></i>
          Clear Completed
        </button>
        <div class="dropdown position-relative">
          <button
            class="btn btn-outline-light btn-sm"
            type="button"
            @click="showDropdown = !showDropdown"
          >
            <i class="bi bi-gear"></i>
          </button>
          <ul 
            v-if="showDropdown"
            class="dropdown-menu dropdown-menu-end show position-absolute"
            style="top: 100%; right: 0; z-index: 1000;"
          >
            <li>
              <button class="dropdown-item" @click="clearOldJobs(7)">
                <i class="bi bi-calendar-week me-2"></i>
                Clear jobs older than 7 days
              </button>
            </li>
            <li>
              <button class="dropdown-item" @click="clearOldJobs(1)">
                <i class="bi bi-calendar-day me-2"></i>
                Clear jobs older than 1 day
              </button>
            </li>
            <li><hr class="dropdown-divider"></li>
            <li>
              <button class="dropdown-item text-danger" @click="confirmClearAll">
                <i class="bi bi-trash3 me-2"></i>
                Clear all download history
              </button>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <div class="card-body p-0" style="max-height: 500px; overflow-y: auto;">
      <div v-if="downloadStore.jobs.length === 0" class="text-center py-5 text-muted">
        <i class="bi bi-inbox display-4 d-block mb-3 text-muted"></i>
        <p class="mb-2">No downloads yet.</p>
        <small class="d-block mb-2">Add a URL above to get started!</small>
        <small class="text-info">
          <i class="bi bi-info-circle me-1"></i>
          Downloads persist across browser sessions
        </small>
      </div>

      <div v-else class="list-group list-group-flush">
        <div
          v-for="job in downloadStore.jobs"
          :key="job.id || 'unknown'"
          class="list-group-item list-group-item-action"
        >
          <div class="d-flex align-items-start justify-content-between">
            <div class="flex-grow-1 min-w-0">
              <!-- Status and Time -->
              <div class="d-flex align-items-center mb-2">
                <span
                  class="badge me-2"
                  :class="{
                    'bg-warning': job.status === 'pending',
                    'bg-primary': job.status === 'downloading',
                    'bg-success': job.status === 'completed',
                    'bg-danger': job.status === 'error',
                    'bg-secondary': job.status === 'cancelled'
                  }"
                >
                  <i class="bi" :class="{
                    'bi-clock': job.status === 'pending',
                    'bi-download': job.status === 'downloading',
                    'bi-check-circle': job.status === 'completed',
                    'bi-exclamation-triangle': job.status === 'error',
                    'bi-x-circle': job.status === 'cancelled'
                  }"></i>
                  {{ job.status || 'unknown' }}
                </span>
                <small class="text-muted">
                  <i class="bi bi-clock me-1"></i>
                  {{ formatTime(job.startTime) }}
                  <span v-if="job.endTime" class="ms-2">
                    - {{ formatTime(job.endTime) }}
                  </span>
                </small>
              </div>
              
              <!-- URL -->
              <p class="mb-2 small" style="word-break: break-all; overflow-wrap: break-word; line-height: 1.3;">
                <i class="bi bi-link-45deg me-1"></i>
                <a class="text-muted" :href="job.url || '#'" target="_blank" :title="job.url || 'No URL'">{{ job.url || 'No URL' }}</a>
              </p>

              <!-- Progress Bar -->
              <div v-if="job.status === 'downloading'" class="mb-2">
                <div class="progress" style="height: 10px;">
                  <div
                    class="progress-bar progress-bar-striped progress-bar-animated"
                    role="progressbar"
                    :style="{ width: `${Number(job.progress || 0)}%` }"
                    :aria-valuenow="Number(job.progress || 0)"
                    aria-valuemin="0"
                    aria-valuemax="100"
                  ></div>
                </div>
                <div class="d-flex justify-content-between align-items-center mt-1">
                  <small class="text-muted">
                    <strong>{{ Number(job.progress || 0).toFixed(1) }}%</strong> complete
                  </small>
                  <small class="text-muted" v-if="getEtaFromLogs(job)">
                    ETA: {{ getEtaFromLogs(job) }}
                  </small>
                </div>
              </div>

              <!-- Output/Error Messages -->
              <div v-if="job.status === 'completed'" class="alert alert-success alert-sm p-2 mb-2">
                <i class="bi bi-check-circle me-1"></i>
                <small>Download completed successfully</small>
              </div>

              <!-- Files (with Post-to-Usenet) -->
              <div
                v-if="job.status === 'completed' && job.files && job.files.length > 0"
                class="mb-2"
              >
                <div
                  v-for="file in job.files"
                  :key="file.path"
                  class="d-flex align-items-center justify-content-between gap-2 p-2 bg-light rounded mb-1"
                >
                  <div class="small text-truncate" :title="file.path">
                    <i class="bi bi-file-earmark-play me-1"></i>
                    {{ basename(file.path) }}
                  </div>
                  <button
                    v-if="usenetStore.enabled"
                    @click="postFile(job.id, file.path)"
                    :disabled="postedFiles.has(file.path)"
                    class="btn btn-outline-info btn-sm flex-shrink-0"
                    title="Enqueue this file for Usenet upload"
                  >
                    <i class="bi bi-cloud-upload me-1"></i>
                    {{ postedFiles.has(file.path) ? 'Queued' : 'Post to Usenet' }}
                  </button>
                </div>
              </div>
              
              <div v-if="job.error" class="alert alert-danger alert-sm p-2 mb-2">
                <i class="bi bi-exclamation-triangle me-1"></i>
                <small>{{ job.error }}</small>
              </div>

              <!-- Real-time Logs -->
              <div v-if="job.logs && job.logs.length > 0" class="mb-2">
                <button
                  @click="toggleLogs(job.id)"
                  class="btn btn-outline-info btn-sm"
                >
                  <i class="bi" :class="expandedLogs[job.id] ? 'bi-chevron-up' : 'bi-chevron-down'"></i>
                  {{ expandedLogs[job.id] ? 'Hide' : 'Show' }} Logs
                </button>
                <div
                  v-if="expandedLogs[job.id]"
                  class="mt-2 p-2 bg-dark text-success font-monospace small rounded"
                  style="max-height: 120px; overflow-x: auto; white-space: nowrap;"
                >
                  <div v-for="(log, index) in job.logs.slice(-10)" :key="index" class="mb-1" style="white-space: pre;">
                    {{ log }}
                  </div>
                </div>
              </div>

              <!-- Job Options Summary -->
              <div class="d-flex flex-wrap gap-1 mb-0" v-if="job.options">
                <span
                  v-if="job.options.allEpisodes"
                  class="badge bg-primary"
                >
                  <i class="bi bi-collection-play me-1"></i>
                  All Episodes
                </span>
                <span
                  v-if="job.options.resolution"
                  class="badge bg-secondary"
                >
                  {{ job.options.resolution }}p
                </span>
                <span
                  v-if="job.options.token"
                  class="badge bg-dark"
                >
                  <i class="bi bi-key me-1"></i>
                  Token Auth
                </span>
                <span
                  v-if="job.options.username"
                  class="badge bg-warning text-dark"
                >
                  <i class="bi bi-person me-1"></i>
                  User Auth
                </span>
              </div>
            </div>

            <!-- Action Buttons -->
            <div class="ms-2 d-flex flex-column gap-1">
              <button
                v-if="job.status === 'downloading'"
                @click="downloadStore.cancelDownload(job.id)"
                class="btn btn-outline-warning btn-sm"
                title="Cancel Download"
              >
                <i class="bi bi-pause-circle"></i>
              </button>
              <button
                @click="downloadStore.removeJob(job.id)"
                class="btn btn-outline-danger btn-sm"
                title="Remove Job"
              >
                <i class="bi bi-x-circle"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Statistics Footer -->
    <div v-if="downloadStore.jobs.length > 0" class="card-footer bg-light">
      <div class="row text-center">
        <div class="col-4">
          <div class="fw-bold text-primary fs-5">
            {{ downloadStore.activeJobs.length }}
          </div>
          <small class="text-muted">
            <i class="bi bi-play-circle me-1"></i>
            Active
          </small>
        </div>
        <div class="col-4">
          <div class="fw-bold text-success fs-5">
            {{ downloadStore.completedJobs.length }}
          </div>
          <small class="text-muted">
            <i class="bi bi-check-circle me-1"></i>
            Completed
          </small>
        </div>
        <div class="col-4">
          <div class="fw-bold text-danger fs-5">
            {{ downloadStore.errorJobs.length }}
          </div>
          <small class="text-muted">
            <i class="bi bi-exclamation-circle me-1"></i>
            Errors
          </small>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useDownloadStore } from '../stores/downloadStore'
import { useUsenetStore } from '../stores/usenetStore'

const downloadStore = useDownloadStore()
const usenetStore = useUsenetStore()
const expandedLogs = ref<Record<string, boolean>>({})
const showDropdown = ref(false)
const postedFiles = ref<Set<string>>(new Set())

const postFile = (jobId: string, filePath: string) => {
  downloadStore.postToUsenet(jobId, filePath)
  postedFiles.value.add(filePath)
}

const basename = (p: string): string => {
  if (!p) return ''
  const parts = p.split(/[\\/]/)
  return parts[parts.length - 1] || p
}

const hasPersistedJobs = computed(() => {
  return downloadStore.jobs.length > 0
})

// Close dropdown when clicking outside
const handleClickOutside = (event: Event) => {
  const target = event.target as HTMLElement
  if (!target.closest('.dropdown')) {
    showDropdown.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})

const formatTime = (date?: Date): string => {
  if (!date) return ''
  return date.toLocaleTimeString()
}

const toggleLogs = (jobId: string) => {
  expandedLogs.value[jobId] = !expandedLogs.value[jobId]
}

const getEtaFromLogs = (job: any): string => {
  // Look for the latest ETA info in logs
  if (!job?.logs || !Array.isArray(job.logs)) return ''
  
  const recentLogs = job.logs.slice(-10) // Check last 10 log entries
  for (let i = recentLogs.length - 1; i >= 0; i--) {
    const log = recentLogs[i]
    if (typeof log === 'string') {
      const etaMatch = log.match(/ETA:\s*(\d+:\d+:\d+|\d+:\d+)/)
      if (etaMatch) {
        return etaMatch[1]
      }
    }
  }
  return ''
}

const confirmClearAll = () => {
  if (confirm('Are you sure you want to clear all download history? This action cannot be undone.')) {
    downloadStore.clearAllData()
    showDropdown.value = false
  }
}

const clearOldJobs = (days: number) => {
  downloadStore.clearOldJobs(days)
  showDropdown.value = false
}

</script>
