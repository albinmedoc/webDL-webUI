<template>
  <div class="card shadow-sm h-100">
    <div class="card-header bg-info text-white d-flex justify-content-between align-items-center">
      <h5 class="card-title mb-0">
        <i class="bi bi-cloud-upload me-2"></i>
        Usenet Uploads
      </h5>
      <span class="badge bg-light text-info" v-if="usenetStore.activeJobs.length > 0">
        {{ usenetStore.activeJobs.length }} active
      </span>
    </div>

    <div class="card-body p-0" style="max-height: 500px; overflow-y: auto;">
      <div v-if="usenetStore.lastError" class="alert alert-danger m-2 mb-0 py-2 small">
        <i class="bi bi-exclamation-triangle me-1"></i>
        {{ usenetStore.lastError }}
        <button class="btn-close float-end" @click="usenetStore.clearError()" aria-label="Dismiss"></button>
      </div>

      <div v-if="usenetStore.jobs.length === 0" class="text-center py-5 text-muted">
        <i class="bi bi-cloud display-4 d-block mb-3 text-muted"></i>
        <p class="mb-2">No Usenet jobs yet.</p>
        <small class="d-block">Tick "Auto-post to Usenet" to start uploading downloads.</small>
      </div>

      <div v-else class="list-group list-group-flush">
        <div
          v-for="job in usenetStore.jobs"
          :key="job.id"
          class="list-group-item"
        >
          <div class="d-flex align-items-start justify-content-between">
            <div class="flex-grow-1 min-w-0">
              <div class="d-flex align-items-center mb-2 flex-wrap gap-1">
                <span class="badge" :class="badgeClass(job.state)">
                  <i class="bi" :class="stateIcon(job.state)"></i>
                  {{ job.state }}
                </span>
                <span v-if="job.failureState" class="badge bg-light text-dark border">
                  failed in {{ job.failureState }}
                </span>
                <small class="text-muted ms-1">
                  {{ formatTime(job.updatedAt) }}
                </small>
              </div>

              <p class="mb-2 small text-truncate" :title="job.mediaPath">
                <i class="bi bi-file-earmark-play me-1"></i>
                {{ basename(job.mediaPath) }}
                <span class="text-muted">({{ formatSize(job.mediaSizeBytes) }})</span>
              </p>

              <div v-if="job.state === 'posting' || job.state === 'archiving' || job.state === 'par2'" class="mb-2">
                <div class="progress" style="height: 8px;">
                  <div
                    class="progress-bar progress-bar-striped progress-bar-animated"
                    :class="badgeClass(job.state).replace('bg-', 'bg-')"
                    role="progressbar"
                    :style="{ width: `${job.progress || 0}%` }"
                  ></div>
                </div>
                <small class="text-muted">{{ job.progress || 0 }}%</small>
              </div>

              <div v-if="job.error" class="alert alert-danger p-2 mb-2 small">
                <i class="bi bi-exclamation-triangle me-1"></i>
                {{ job.error }}
              </div>

              <div v-if="job.nzbPath && job.state === 'done'" class="small mb-2">
                <a
                  :href="`/api/usenet/jobs/${job.id}/nzb`"
                  :download="basename(job.nzbPath)"
                  class="text-decoration-none"
                  title="Download NZB"
                >
                  <i class="bi bi-download me-1"></i>
                  <code>{{ basename(job.nzbPath) }}</code>
                </a>
              </div>

              <div v-if="job.logs.length > 0" class="mb-1">
                <button @click="toggleLogs(job.id)" class="btn btn-outline-secondary btn-sm">
                  <i class="bi" :class="expandedLogs[job.id] ? 'bi-chevron-up' : 'bi-chevron-down'"></i>
                  {{ expandedLogs[job.id] ? 'Hide' : 'Show' }} Logs
                </button>
                <div
                  v-if="expandedLogs[job.id]"
                  class="mt-2 p-2 bg-dark text-info font-monospace small rounded"
                  style="max-height: 120px; overflow-y: auto;"
                >
                  <div v-for="(log, i) in job.logs.slice(-30)" :key="i" style="white-space: pre-wrap;">{{ log }}</div>
                </div>
              </div>
            </div>

            <div class="ms-2 d-flex flex-column gap-1">
              <button
                v-if="canCancel(job.state)"
                @click="requestCancel(job)"
                class="btn btn-outline-warning btn-sm"
                title="Cancel upload"
              >
                <i class="bi bi-x-octagon"></i>
              </button>
              <button
                v-if="job.state === 'failed'"
                @click="usenetStore.retry(job.id)"
                class="btn btn-outline-primary btn-sm"
                :title="job.failureState === 'indexing' && job.nzbPath ? 'Retry indexer hook' : 'Retry full upload'"
              >
                <i class="bi bi-arrow-clockwise"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Cancel-confirm modal -->
    <div v-if="cancelTarget" class="modal-backdrop-custom" @click.self="cancelTarget = null">
      <div class="modal-dialog-custom card shadow-lg">
        <div class="card-header bg-warning">
          <h6 class="mb-0"><i class="bi bi-exclamation-triangle me-2"></i>Cancel upload?</h6>
        </div>
        <div class="card-body">
          <p class="mb-2">Cancel will discard any partial upload — continue?</p>
          <div v-if="cancelTarget.state === 'posting'" class="alert alert-danger p-2 small mb-0">
            <i class="bi bi-radioactive me-1"></i>
            <strong>Articles already posted to Eweka will be orphaned and unrecoverable.</strong>
            The NZB will not be written, so there is no way to retrieve them.
          </div>
        </div>
        <div class="card-footer d-flex justify-content-end gap-2">
          <button class="btn btn-secondary btn-sm" @click="cancelTarget = null">Keep running</button>
          <button class="btn btn-danger btn-sm" @click="confirmCancel">
            <i class="bi bi-x-octagon me-1"></i>
            Cancel upload
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useUsenetStore, type UsenetJob, type UsenetState, NON_TERMINAL_STATES } from '../stores/usenetStore'

const usenetStore = useUsenetStore()
const expandedLogs = ref<Record<string, boolean>>({})
const cancelTarget = ref<UsenetJob | null>(null)

function toggleLogs(id: string) {
  expandedLogs.value[id] = !expandedLogs.value[id]
}

function canCancel(state: UsenetState): boolean {
  return NON_TERMINAL_STATES.includes(state)
}

function requestCancel(job: UsenetJob) {
  cancelTarget.value = job
}

function confirmCancel() {
  if (cancelTarget.value) {
    usenetStore.cancel(cancelTarget.value.id)
    cancelTarget.value = null
  }
}

function basename(p: string): string {
  if (!p) return ''
  const parts = p.split(/[\\/]/)
  return parts[parts.length - 1] || p
}

function formatSize(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`
}

function formatTime(ts: number): string {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString()
}

function badgeClass(state: UsenetState): string {
  switch (state) {
    case 'queued':
      return 'bg-secondary'
    case 'archiving':
      return 'bg-info'
    case 'par2':
      return 'bg-info'
    case 'posting':
      return 'bg-primary'
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

function stateIcon(state: UsenetState): string {
  switch (state) {
    case 'queued':
      return 'bi-clock'
    case 'archiving':
      return 'bi-file-zip'
    case 'par2':
      return 'bi-shield-check'
    case 'posting':
      return 'bi-cloud-upload'
    case 'posted':
      return 'bi-cloud-check'
    case 'indexing':
      return 'bi-search'
    case 'done':
      return 'bi-check-circle'
    case 'failed':
      return 'bi-exclamation-triangle'
    case 'cancelled':
      return 'bi-x-circle'
  }
}
</script>

<style scoped>
.modal-backdrop-custom {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 1050;
  display: flex;
  align-items: center;
  justify-content: center;
}
.modal-dialog-custom {
  max-width: 480px;
  width: 90%;
}
</style>
