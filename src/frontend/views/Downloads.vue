<template>
  <main class="container-fluid py-4 d-flex flex-column gap-3">
    <div class="card shadow-sm">
      <div
        class="card-header bg-success text-white d-flex justify-content-between align-items-center flex-wrap gap-2"
      >
        <h5 class="card-title mb-0">
          <i class="bi bi-list-task me-2"></i>
          Downloads
          <span class="badge bg-light text-dark ms-2">{{ filteredJobs.length }}</span>
        </h5>
        <div class="d-flex gap-2 align-items-center">
          <span class="small me-2">
            <span class="text-warning"><i class="bi bi-play-circle me-1"></i>{{ downloadStore.activeJobs.length }}</span>
            <span class="ms-2 text-success-emphasis"><i class="bi bi-check-circle me-1"></i>{{ downloadStore.completedJobs.length }}</span>
            <span class="ms-2 text-danger"><i class="bi bi-exclamation-circle me-1"></i>{{ downloadStore.errorJobs.length }}</span>
          </span>
          <button class="btn btn-light btn-sm" type="button" @click="showFormModal = true">
            <i class="bi bi-plus-lg me-1"></i>
            New download
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
                <button class="dropdown-item" @click="runStoreAction(downloadStore.clearCompletedJobs)">
                  <i class="bi bi-check-circle me-2"></i>
                  Clear completed
                </button>
              </li>
              <li>
                <button class="dropdown-item" @click="runStoreAction(() => downloadStore.clearOldJobs(7))">
                  <i class="bi bi-calendar-week me-2"></i>
                  Clear jobs older than 7 days
                </button>
              </li>
              <li>
                <button class="dropdown-item" @click="runStoreAction(() => downloadStore.clearOldJobs(1))">
                  <i class="bi bi-calendar-day me-2"></i>
                  Clear jobs older than 1 day
                </button>
              </li>
              <li><hr class="dropdown-divider" /></li>
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

      <div class="card-body">
        <!-- Filters -->
        <div class="row g-2 mb-3">
          <div class="col-md-6">
            <label class="form-label small text-muted mb-1">Search URL or filename</label>
            <input
              v-model="searchInput"
              type="text"
              class="form-control form-control-sm"
              placeholder="e.g. svtplay.se/program/… or filename"
            />
          </div>
          <div class="col-md-3">
            <label class="form-label small text-muted mb-1">Status</label>
            <select v-model="statusFilter" class="form-select form-select-sm">
              <option value="">All statuses</option>
              <option v-for="s in ALL_STATUSES" :key="s" :value="s">{{ s }}</option>
            </select>
          </div>
          <div class="col-md-3 d-flex align-items-end">
            <button
              v-if="searchInput || statusFilter"
              class="btn btn-outline-secondary btn-sm w-100"
              @click="resetFilters"
            >
              <i class="bi bi-x-circle me-1"></i>
              Clear filters
            </button>
          </div>
        </div>

        <div v-if="errorMessage" class="alert alert-danger py-2 small">
          <i class="bi bi-exclamation-triangle me-1"></i>
          {{ errorMessage }}
        </div>

        <!-- Bulk actions -->
        <div
          v-if="selectedIds.size > 0"
          class="d-flex align-items-center flex-wrap gap-2 mb-2 p-2 bg-light border rounded small"
        >
          <span class="me-2">
            <strong>{{ selectedIds.size }}</strong> selected
          </span>
          <button
            class="btn btn-outline-warning btn-sm"
            :disabled="bulkBusy || selectedActiveCount === 0"
            @click="bulkCancel"
            :title="`Cancel ${selectedActiveCount} active download(s)`"
          >
            <i class="bi bi-pause-circle me-1"></i>
            Cancel ({{ selectedActiveCount }})
          </button>
          <button
            v-if="usenetStore.enabled"
            class="btn btn-outline-info btn-sm"
            :disabled="bulkBusy || selectedPostableFileCount === 0"
            @click="bulkPostToUsenet"
            :title="`Post ${selectedPostableFileCount} file(s) to Usenet`"
          >
            <i class="bi bi-cloud-upload me-1"></i>
            Post to Usenet ({{ selectedPostableFileCount }})
          </button>
          <button
            class="btn btn-outline-danger btn-sm"
            :disabled="bulkBusy"
            @click="bulkRemove"
            :title="`Remove ${selectedIds.size} job(s)`"
          >
            <i class="bi bi-trash me-1"></i>
            Remove ({{ selectedIds.size }})
          </button>
          <button class="btn btn-link btn-sm ms-auto" :disabled="bulkBusy" @click="clearSelection">
            Clear selection
          </button>
        </div>

        <!-- Empty states -->
        <div v-if="downloadStore.jobs.length === 0" class="text-center py-5 text-muted">
          <i class="bi bi-inbox display-4 d-block mb-3"></i>
          <p class="mb-2">No downloads yet.</p>
          <button class="btn btn-success btn-sm" type="button" @click="showFormModal = true">
            <i class="bi bi-plus-lg me-1"></i>
            Add your first download
          </button>
        </div>

        <div
          v-else-if="filteredJobs.length === 0"
          class="text-center py-5 text-muted"
        >
          <i class="bi bi-funnel display-4 d-block mb-3"></i>
          No downloads match the current filters.
        </div>

        <!-- Table -->
        <div v-else class="table-responsive">
          <table class="table table-sm table-hover align-middle">
            <thead class="table-light">
              <tr>
                <th style="width: 32px">
                  <input
                    type="checkbox"
                    class="form-check-input"
                    :checked="allOnPageSelected"
                    :indeterminate.prop="someOnPageSelected && !allOnPageSelected"
                    @change="toggleSelectAllOnPage"
                    :disabled="filteredJobs.length === 0"
                    title="Select all"
                  />
                </th>
                <th style="min-width: 280px">URL / file</th>
                <th>Status</th>
                <th style="min-width: 140px">Progress</th>
                <th>Created</th>
                <th class="text-end">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="job in filteredJobs"
                :key="job.id"
                :class="{ 'table-active': selectedIds.has(job.id) }"
              >
                <td>
                  <input
                    type="checkbox"
                    class="form-check-input"
                    :checked="selectedIds.has(job.id)"
                    @change="toggleOne(job.id)"
                  />
                </td>
                <td>
                  <button
                    v-if="job.files.length > 0"
                    type="button"
                    class="btn btn-link p-0 text-start text-decoration-none text-truncate fw-semibold d-block"
                    style="max-width: 420px"
                    :title="`${job.files.map((f) => f.path).join('\n')}\n\nClick to view all files`"
                    @click="openFiles(job.id)"
                  >
                    <i class="bi bi-file-earmark-play me-1 text-muted"></i>
                    {{ basename(job.files[0].path) }}
                    <span v-if="job.files.length > 1" class="text-muted small ms-1">
                      +{{ job.files.length - 1 }} more
                    </span>
                  </button>
                  <a
                    class="d-inline-block text-truncate text-muted small"
                    style="max-width: 420px"
                    :href="job.url"
                    :title="job.url"
                    target="_blank"
                    rel="noopener"
                  >
                    <i class="bi bi-link-45deg me-1"></i>
                    {{ job.url }}
                  </a>
                  <div class="d-flex flex-wrap gap-1 mt-1">
                    <span v-if="job.allEpisodes" class="badge bg-light text-dark border">
                      <i class="bi bi-collection-play me-1"></i>All episodes
                    </span>
                    <span v-if="job.resolution" class="badge bg-light text-dark border">
                      {{ job.resolution }}p
                    </span>
                    <span v-if="job.autoPostUsenet" class="badge bg-light text-dark border">
                      <i class="bi bi-cloud-upload me-1"></i>Auto-post
                    </span>
                  </div>
                </td>
                <td>
                  <span class="badge" :class="badgeClass(job.status)">
                    <i class="bi" :class="statusIcon(job.status)"></i>
                    {{ job.status }}
                  </span>
                  <div
                    v-if="job.error"
                    class="small text-danger mt-1 text-truncate"
                    style="max-width: 220px"
                    :title="job.error"
                  >
                    {{ job.error }}
                  </div>
                </td>
                <td>
                  <div v-if="job.status === 'downloading'" class="progress" style="height: 6px;">
                    <div
                      class="progress-bar progress-bar-striped progress-bar-animated"
                      role="progressbar"
                      :style="{ width: `${Number(job.progress) || 0}%` }"
                    ></div>
                  </div>
                  <small class="text-muted">{{ Number(job.progress || 0).toFixed(1) }}%</small>
                  <div v-if="getEtaFromLogs(job)" class="small text-muted">
                    ETA {{ getEtaFromLogs(job) }}
                  </div>
                </td>
                <td>
                  <small class="text-muted">{{ formatDate(job.createdAt) }}</small>
                  <div v-if="job.endTime" class="small text-muted">
                    {{ formatDuration(job) }}
                  </div>
                </td>
                <td class="text-end">
                  <div class="btn-group btn-group-sm" role="group">
                    <button
                      class="btn btn-outline-secondary"
                      @click="openLogs(job.id)"
                      title="View logs"
                    >
                      <i class="bi bi-terminal"></i>
                    </button>
                    <button
                      v-if="job.files.length > 0"
                      class="btn btn-outline-success"
                      @click="openFiles(job.id)"
                      :title="`View ${job.files.length} file(s)`"
                    >
                      <i class="bi bi-folder2-open"></i>
                    </button>
                    <button
                      v-if="job.status === 'downloading'"
                      class="btn btn-outline-warning"
                      @click="downloadStore.cancelDownload(job.id)"
                      title="Cancel download"
                    >
                      <i class="bi bi-pause-circle"></i>
                    </button>
                    <button
                      v-if="
                        usenetStore.enabled &&
                        job.status === 'completed' &&
                        job.files.length > 0
                      "
                      class="btn btn-outline-info"
                      @click="postJob(job)"
                      :disabled="postedJobIds.has(job.id)"
                      :title="
                        postedJobIds.has(job.id)
                          ? 'Already queued for Usenet'
                          : `Post ${job.files.length} file(s) to Usenet`
                      "
                    >
                      <i class="bi bi-cloud-upload"></i>
                    </button>
                    <button
                      class="btn btn-outline-danger"
                      @click="downloadStore.removeJob(job.id)"
                      title="Remove job"
                    >
                      <i class="bi bi-x-circle"></i>
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <DownloadLogsModal
      v-if="logsJobId"
      :job-id="logsJobId"
      @close="closeLogs"
    />

    <DownloadFilesModal
      v-if="filesJobId"
      :job-id="filesJobId"
      @close="closeFiles"
    />

    <Teleport v-if="showFormModal" to="body">
      <div class="modal-backdrop-custom" @click.self="showFormModal = false">
        <div class="modal-dialog-custom">
          <div class="position-relative">
            <button
              type="button"
              class="btn-close btn-close-white position-absolute"
              style="top: 1rem; right: 1rem; z-index: 5;"
              aria-label="Close"
              @click="showFormModal = false"
            ></button>
            <DownloadForm @submitted="showFormModal = false" />
          </div>
        </div>
      </div>
    </Teleport>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  useDownloadStore,
  type DownloadJob,
  type DownloadStatus,
} from '../stores/downloadStore'
import { useUsenetStore } from '../stores/usenetStore'
import DownloadFilesModal from '../components/DownloadFilesModal.vue'
import DownloadForm from '../components/DownloadForm.vue'
import DownloadLogsModal from '../components/DownloadLogsModal.vue'

const ALL_STATUSES: DownloadStatus[] = [
  'pending',
  'downloading',
  'completed',
  'error',
  'cancelled',
]

const ACTIVE_STATUSES: DownloadStatus[] = ['pending', 'downloading']

const downloadStore = useDownloadStore()
const usenetStore = useUsenetStore()

const searchInput = ref('')
const statusFilter = ref<DownloadStatus | ''>('')
const selectedIds = ref<Set<string>>(new Set())
const bulkBusy = ref(false)
const errorMessage = ref<string | null>(null)
const showDropdown = ref(false)
const showFormModal = ref(false)
const logsJobId = ref<string | null>(null)
const filesJobId = ref<string | null>(null)
const postedJobIds = ref<Set<string>>(new Set())

const filteredJobs = computed<DownloadJob[]>(() => {
  const q = searchInput.value.trim().toLowerCase()
  return downloadStore.jobs.filter((job) => {
    if (statusFilter.value && job.status !== statusFilter.value) return false
    if (q) {
      const url = (job.url || '').toLowerCase()
      const inFiles = job.files.some((f) => f.path.toLowerCase().includes(q))
      if (!url.includes(q) && !inFiles) return false
    }
    return true
  })
})

const selectedJobs = computed(() =>
  downloadStore.jobs.filter((j) => selectedIds.value.has(j.id)),
)
const selectedActiveCount = computed(
  () => selectedJobs.value.filter((j) => ACTIVE_STATUSES.includes(j.status)).length,
)
const selectedPostableFileCount = computed(() =>
  selectedJobs.value
    .filter((j) => j.status === 'completed')
    .reduce((sum, j) => sum + j.files.length, 0),
)

const allOnPageSelected = computed(
  () =>
    filteredJobs.value.length > 0 &&
    filteredJobs.value.every((j) => selectedIds.value.has(j.id)),
)
const someOnPageSelected = computed(() =>
  filteredJobs.value.some((j) => selectedIds.value.has(j.id)),
)

function resetFilters(): void {
  searchInput.value = ''
  statusFilter.value = ''
}

function toggleOne(id: string): void {
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
}

function toggleSelectAllOnPage(): void {
  const next = new Set(selectedIds.value)
  if (allOnPageSelected.value) {
    for (const j of filteredJobs.value) next.delete(j.id)
  } else {
    for (const j of filteredJobs.value) next.add(j.id)
  }
  selectedIds.value = next
}

function clearSelection(): void {
  selectedIds.value = new Set()
}

async function bulkCancel(): Promise<void> {
  const targets = selectedJobs.value.filter((j) => ACTIVE_STATUSES.includes(j.status))
  if (targets.length === 0) return
  if (!window.confirm(`Cancel ${targets.length} active download(s)?`)) return
  bulkBusy.value = true
  try {
    for (const job of targets) {
      downloadStore.cancelDownload(job.id)
    }
  } finally {
    bulkBusy.value = false
  }
}

async function bulkRemove(): Promise<void> {
  if (selectedIds.value.size === 0) return
  const activeAmong = selectedJobs.value.filter((j) =>
    ACTIVE_STATUSES.includes(j.status),
  ).length
  const lines = [
    `Remove ${selectedIds.value.size} job(s)?`,
  ]
  if (activeAmong > 0) {
    lines.push(`(${activeAmong} are still active and will be cancelled.)`)
  }
  if (!window.confirm(lines.join('\n'))) return
  bulkBusy.value = true
  try {
    for (const job of selectedJobs.value) {
      downloadStore.removeJob(job.id)
    }
    clearSelection()
  } finally {
    bulkBusy.value = false
  }
}

async function bulkPostToUsenet(): Promise<void> {
  if (!usenetStore.enabled) return
  const targets = selectedJobs.value.filter(
    (j) => j.status === 'completed' && j.files.length > 0,
  )
  const totalFiles = targets.reduce((sum, j) => sum + j.files.length, 0)
  if (totalFiles === 0) return
  if (
    !window.confirm(
      `Post ${totalFiles} file(s) from ${targets.length} job(s) to Usenet?`,
    )
  ) {
    return
  }
  bulkBusy.value = true
  try {
    for (const job of targets) {
      for (const file of job.files) {
        downloadStore.postToUsenet(job.id, file.path)
      }
      postedJobIds.value.add(job.id)
    }
  } finally {
    bulkBusy.value = false
  }
}

function postJob(job: DownloadJob): void {
  for (const file of job.files) {
    downloadStore.postToUsenet(job.id, file.path)
  }
  postedJobIds.value.add(job.id)
}

function openLogs(id: string): void {
  logsJobId.value = id
}

function closeLogs(): void {
  logsJobId.value = null
}

function openFiles(id: string): void {
  filesJobId.value = id
}

function closeFiles(): void {
  filesJobId.value = null
}

function runStoreAction(fn: () => void): void {
  fn()
  showDropdown.value = false
}

function confirmClearAll(): void {
  if (
    window.confirm(
      'Clear all download history? Active downloads will be cancelled. This action cannot be undone.',
    )
  ) {
    downloadStore.clearAllData()
    clearSelection()
  }
  showDropdown.value = false
}

function basename(p: string | null): string {
  if (!p) return ''
  const parts = p.split(/[\\/]/)
  return parts[parts.length - 1] || p
}

function formatDate(ts: number | null): string {
  if (!ts) return ''
  return new Date(ts).toLocaleString()
}

function formatDuration(job: DownloadJob): string {
  if (!job.startTime || !job.endTime) return ''
  const ms = job.endTime - job.startTime
  if (ms < 1000) return `${ms}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rs = s % 60
  if (m < 60) return `${m}m ${rs}s`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return `${h}h ${rm}m`
}

function badgeClass(status: DownloadStatus): string {
  switch (status) {
    case 'pending':
      return 'bg-warning text-dark'
    case 'downloading':
      return 'bg-primary'
    case 'completed':
      return 'bg-success'
    case 'error':
      return 'bg-danger'
    case 'cancelled':
      return 'bg-secondary'
  }
}

function statusIcon(status: DownloadStatus): string {
  switch (status) {
    case 'pending':
      return 'bi-clock'
    case 'downloading':
      return 'bi-download'
    case 'completed':
      return 'bi-check-circle'
    case 'error':
      return 'bi-exclamation-triangle'
    case 'cancelled':
      return 'bi-x-circle'
  }
}

function getEtaFromLogs(job: DownloadJob): string {
  if (!job.logs?.length) return ''
  const recent = job.logs.slice(-10)
  for (let i = recent.length - 1; i >= 0; i--) {
    const log = recent[i]
    if (typeof log === 'string') {
      const m = log.match(/ETA:\s*(\d+:\d+:\d+|\d+:\d+)/)
      if (m) return m[1]
    }
  }
  return ''
}

function handleEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  if (filesJobId.value) closeFiles()
  else if (logsJobId.value) closeLogs()
  else if (showFormModal.value) showFormModal.value = false
}

function handleClickOutside(event: Event): void {
  const target = event.target as HTMLElement
  if (!target.closest('.dropdown')) {
    showDropdown.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
  document.addEventListener('keydown', handleEscape)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
  document.removeEventListener('keydown', handleEscape)
})
</script>

<style scoped>
.modal-backdrop-custom {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 1055;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 2rem 1rem;
  overflow-y: auto;
}
.modal-dialog-custom {
  width: min(720px, 100%);
}
</style>
