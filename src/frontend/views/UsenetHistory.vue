<template>
  <main class="container-fluid py-4">
    <div class="card shadow-sm">
      <div class="card-header bg-info text-white d-flex justify-content-between align-items-center flex-wrap gap-2">
        <h5 class="card-title mb-0">
          <i class="bi bi-clock-history me-2"></i>
          Usenet Upload History
        </h5>
        <button class="btn btn-light btn-sm" @click="reload" :disabled="loading">
          <i class="bi" :class="loading ? 'bi-arrow-clockwise' : 'bi-arrow-clockwise'"></i>
          Refresh
        </button>
      </div>

      <div class="card-body">
        <!-- Filters -->
        <div class="row g-2 mb-3">
          <div class="col-md-4">
            <label class="form-label small text-muted mb-1">Search filename</label>
            <input
              v-model="searchInput"
              type="text"
              class="form-control form-control-sm"
              placeholder="e.g. dox.season.01"
              @keyup.enter="applyFilters"
            />
          </div>
          <div class="col-md-3">
            <label class="form-label small text-muted mb-1">State</label>
            <select v-model="stateFilter" class="form-select form-select-sm" @change="applyFilters">
              <option value="">All states</option>
              <option v-for="s in ALL_STATES" :key="s" :value="s">{{ s }}</option>
            </select>
          </div>
          <div class="col-md-2">
            <label class="form-label small text-muted mb-1">Page size</label>
            <select v-model.number="pageSize" class="form-select form-select-sm" @change="applyFilters">
              <option :value="10">10</option>
              <option :value="25">25</option>
              <option :value="50">50</option>
              <option :value="100">100</option>
            </select>
          </div>
          <div class="col-md-3 d-flex align-items-end">
            <button class="btn btn-primary btn-sm w-100" @click="applyFilters" :disabled="loading">
              <i class="bi bi-funnel me-1"></i>
              Apply
            </button>
          </div>
        </div>

        <div v-if="errorMessage" class="alert alert-danger py-2 small">
          <i class="bi bi-exclamation-triangle me-1"></i>
          {{ errorMessage }}
        </div>

        <div v-if="loading && jobs.length === 0" class="text-center py-5 text-muted">
          <div class="spinner-border text-info" role="status"></div>
          <div class="mt-2">Loading…</div>
        </div>

        <div v-else-if="!loading && jobs.length === 0" class="text-center py-5 text-muted">
          <i class="bi bi-inbox display-4 d-block mb-3"></i>
          No jobs match the current filters.
        </div>

        <div v-else class="table-responsive">
          <table class="table table-sm table-hover align-middle">
            <thead class="table-light">
              <tr>
                <th style="min-width: 220px">File</th>
                <th>State</th>
                <th>Progress</th>
                <th>Size</th>
                <th>Created</th>
                <th class="text-end">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="job in jobs" :key="job.id">
                <td>
                  <div class="text-truncate" style="max-width: 360px" :title="job.mediaPath">
                    <i class="bi bi-file-earmark-play me-1 text-muted"></i>
                    {{ basename(job.mediaPath) }}
                  </div>
                  <small class="text-muted">{{ job.id.slice(0, 8) }}</small>
                  <span v-if="job.category" class="badge bg-light text-dark border ms-1">
                    {{ job.category }}
                  </span>
                </td>
                <td>
                  <span class="badge" :class="badgeClass(job.state)">
                    <i class="bi" :class="stateIcon(job.state)"></i>
                    {{ job.state }}
                  </span>
                  <div v-if="job.failureState" class="small text-muted mt-1">
                    failed in {{ job.failureState }}
                  </div>
                  <div v-if="job.error" class="small text-danger mt-1 text-truncate" style="max-width: 200px" :title="job.error">
                    {{ job.error }}
                  </div>
                </td>
                <td style="min-width: 120px">
                  <div v-if="!isTerminal(job.state)" class="progress" style="height: 6px;">
                    <div
                      class="progress-bar"
                      :class="badgeClass(job.state)"
                      role="progressbar"
                      :style="{ width: `${job.progress || 0}%` }"
                    ></div>
                  </div>
                  <small class="text-muted">{{ job.progress || 0 }}%</small>
                </td>
                <td>{{ formatSize(job.mediaSizeBytes) }}</td>
                <td>
                  <small class="text-muted">{{ formatDate(job.createdAt) }}</small>
                </td>
                <td class="text-end">
                  <div class="btn-group btn-group-sm" role="group">
                    <button
                      class="btn btn-outline-secondary"
                      @click="togglePassword(job.id)"
                      title="Reveal RAR password"
                    >
                      <i class="bi" :class="passwordVisible[job.id] ? 'bi-eye-slash' : 'bi-eye'"></i>
                    </button>
                    <a
                      v-if="job.nzbPath"
                      class="btn btn-outline-primary"
                      :href="`/api/usenet/jobs/${job.id}/nzb`"
                      :download="basename(job.nzbPath)"
                      title="Download NZB"
                    >
                      <i class="bi bi-file-earmark-zip"></i>
                    </a>
                    <button
                      v-if="job.state === 'failed'"
                      class="btn btn-outline-warning"
                      @click="retry(job)"
                      :title="retryLabel(job)"
                    >
                      <i class="bi bi-arrow-clockwise"></i>
                    </button>
                  </div>
                  <div v-if="passwordVisible[job.id]" class="mt-2">
                    <code v-if="passwordCache[job.id]" class="small">{{ passwordCache[job.id] }}</code>
                    <span v-else class="small text-muted">loading…</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Pagination -->
        <div v-if="jobs.length > 0" class="d-flex justify-content-between align-items-center mt-3">
          <small class="text-muted">
            Showing {{ rangeStart }}–{{ rangeEnd }} of {{ total }}
          </small>
          <nav>
            <ul class="pagination pagination-sm mb-0">
              <li class="page-item" :class="{ disabled: page <= 1 || loading }">
                <button class="page-link" @click="goTo(page - 1)">
                  <i class="bi bi-chevron-left"></i>
                </button>
              </li>
              <li class="page-item disabled">
                <span class="page-link">{{ page }} / {{ totalPages }}</span>
              </li>
              <li class="page-item" :class="{ disabled: page >= totalPages || loading }">
                <button class="page-link" @click="goTo(page + 1)">
                  <i class="bi bi-chevron-right"></i>
                </button>
              </li>
            </ul>
          </nav>
        </div>
      </div>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useUsenetStore, type UsenetJobSummary, type UsenetState } from '../stores/usenetStore'

const ALL_STATES: UsenetState[] = [
  'queued',
  'archiving',
  'par2',
  'posting',
  'posted',
  'indexing',
  'done',
  'failed',
  'cancelled',
]

const TERMINAL: UsenetState[] = ['done', 'failed', 'cancelled']

const usenetStore = useUsenetStore()

const jobs = ref<UsenetJobSummary[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(25)
const loading = ref(false)
const errorMessage = ref<string | null>(null)

const searchInput = ref('')
const stateFilter = ref<UsenetState | ''>('')

const passwordVisible = ref<Record<string, boolean>>({})
const passwordCache = ref<Record<string, string>>({})

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
const rangeStart = computed(() => (total.value === 0 ? 0 : (page.value - 1) * pageSize.value + 1))
const rangeEnd = computed(() => Math.min(total.value, page.value * pageSize.value))

function isTerminal(state: UsenetState): boolean {
  return TERMINAL.includes(state)
}

async function fetchHistory(): Promise<void> {
  loading.value = true
  errorMessage.value = null
  try {
    const params = new URLSearchParams()
    params.set('page', String(page.value))
    params.set('pageSize', String(pageSize.value))
    if (stateFilter.value) params.set('state', stateFilter.value)
    if (searchInput.value.trim()) params.set('search', searchInput.value.trim())

    const res = await fetch(`/api/usenet/history?${params.toString()}`)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || `HTTP ${res.status}`)
    }
    const data = await res.json()
    jobs.value = data.jobs
    total.value = data.total
    page.value = data.page
    pageSize.value = data.pageSize
  } catch (err) {
    errorMessage.value = (err as Error).message
  } finally {
    loading.value = false
  }
}

function applyFilters(): void {
  page.value = 1
  fetchHistory()
}

function goTo(target: number): void {
  if (target < 1 || target > totalPages.value || loading.value) return
  page.value = target
  fetchHistory()
}

function reload(): void {
  fetchHistory()
}

async function togglePassword(jobId: string): Promise<void> {
  const willShow = !passwordVisible.value[jobId]
  passwordVisible.value[jobId] = willShow
  if (willShow && !passwordCache.value[jobId]) {
    try {
      const res = await fetch(`/api/usenet/jobs/${jobId}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      passwordCache.value[jobId] = data.rarPassword || '(missing)'
    } catch (err) {
      passwordCache.value[jobId] = `(error: ${(err as Error).message})`
    }
  }
}

function retry(job: UsenetJobSummary): void {
  usenetStore.retry(job.id)
  setTimeout(fetchHistory, 500)
}

function retryLabel(job: UsenetJobSummary): string {
  if (job.failureState === 'indexing' && job.nzbPath) return 'Retry indexer hook only'
  return 'Retry full upload (re-archive + re-post)'
}

function basename(p: string | null): string {
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

function formatDate(ts: number): string {
  if (!ts) return ''
  return new Date(ts).toLocaleString()
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

onMounted(() => {
  fetchHistory()
})
</script>
