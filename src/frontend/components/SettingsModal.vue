<template>
  <div class="modal-backdrop-custom" @click.self="$emit('close')">
    <div class="modal-dialog-custom card shadow-lg">
      <div class="card-header bg-primary text-white d-flex justify-content-between align-items-center">
        <h5 class="mb-0">
          <i class="bi bi-gear me-2"></i>
          Usenet Settings
        </h5>
        <button class="btn-close btn-close-white" aria-label="Close" @click="$emit('close')"></button>
      </div>

      <div class="card-body">
        <div v-if="loading" class="text-center py-4 text-muted">
          <div class="spinner-border" role="status"></div>
          <div class="mt-2">Loading config…</div>
        </div>

        <div v-else-if="loadError" class="alert alert-danger small">
          <i class="bi bi-exclamation-triangle me-1"></i>
          {{ loadError }}
        </div>

        <div v-else-if="config">
          <div v-if="!config.enabled" class="alert alert-warning small">
            <i class="bi bi-exclamation-triangle me-1"></i>
            Usenet pipeline is disabled. Set <code>USENET_ENABLED=true</code> to enable.
          </div>

          <h6 class="text-primary mb-2">
            <i class="bi bi-broadcast me-1"></i>
            Connection
          </h6>
          <table class="table table-sm">
            <tbody>
              <tr><th>Host</th><td><code>{{ config.host || '(not set)' }}</code></td></tr>
              <tr><th>Port</th><td>{{ config.port }}</td></tr>
              <tr><th>SSL</th><td>{{ config.ssl ? 'yes' : 'no' }}</td></tr>
              <tr><th>User</th><td><code>{{ config.user || '(not set)' }}</code></td></tr>
              <tr><th>Password</th><td>{{ config.passSet ? '••••••••' : '(not set)' }}</td></tr>
              <tr><th>Connections</th><td>{{ config.connections }}</td></tr>
              <tr><th>Groups</th><td><code>{{ config.groups.join(', ') || '(none)' }}</code></td></tr>
            </tbody>
          </table>

          <h6 class="text-primary mt-3 mb-2">
            <i class="bi bi-archive me-1"></i>
            Archive &amp; PAR2
          </h6>
          <table class="table table-sm">
            <tbody>
              <tr><th>RAR volume size</th><td>{{ config.rarSizeMb }} MB</td></tr>
              <tr><th>PAR2 redundancy</th><td>{{ config.par2Percent }}%</td></tr>
              <tr><th>Max concurrent</th><td>{{ config.maxConcurrent }}</td></tr>
              <tr><th>Disk-space multiplier</th><td>{{ config.minFreeDiskMultiplier }}× media size</td></tr>
              <tr v-if="config.nfoPath"><th>NFO template</th><td><code>{{ config.nfoPath }}</code></td></tr>
            </tbody>
          </table>

          <h6 class="text-primary mt-3 mb-2">
            <i class="bi bi-tag me-1"></i>
            Subject &amp; nyuu
          </h6>
          <table class="table table-sm">
            <tbody>
              <tr><th>Subject template</th><td><code class="small">{{ config.subjectTemplate }}</code></td></tr>
              <tr v-if="config.nyuuExtraArgs.length > 0">
                <th>Extra nyuu args</th>
                <td><code class="small">{{ config.nyuuExtraArgs.join(' ') }}</code></td>
              </tr>
            </tbody>
          </table>

          <h6 class="text-primary mt-3 mb-2">
            <i class="bi bi-search me-1"></i>
            Indexer hook
          </h6>
          <table class="table table-sm">
            <tbody>
              <tr><th>Hook script</th><td>{{ config.indexer.hookScriptSet ? 'configured' : '(not set)' }}</td></tr>
              <tr><th>NZB output dir</th><td><code>{{ config.indexer.nzbOutputDir }}</code></td></tr>
            </tbody>
          </table>

          <hr />

          <h6 class="text-primary mb-2">
            <i class="bi bi-stethoscope me-1"></i>
            Connectivity tests
          </h6>

          <div class="mb-3">
            <div class="d-flex align-items-center gap-2 flex-wrap">
              <strong class="small text-muted">Tools:</strong>
              <span v-if="usenetStore.toolsLoading" class="text-muted small">
                <span class="spinner-border spinner-border-sm me-1"></span>checking…
              </span>
              <template v-else-if="usenetStore.tools">
                <span
                  v-for="tool in toolList"
                  :key="tool.name"
                  class="badge"
                  :class="tool.present ? 'bg-success' : 'bg-danger'"
                >
                  <i class="bi me-1" :class="tool.present ? 'bi-check-circle' : 'bi-x-circle'"></i>
                  {{ tool.name }}
                </span>
              </template>
              <span v-else-if="usenetStore.toolsError" class="text-danger small">
                {{ usenetStore.toolsError }}
              </span>
              <button
                class="btn btn-link btn-sm p-0 ms-auto"
                :disabled="usenetStore.toolsLoading"
                @click="usenetStore.fetchTools(true)"
              >
                <i class="bi bi-arrow-clockwise"></i> Recheck
              </button>
            </div>
            <div
              v-if="usenetStore.tools && !usenetStore.tools.rar"
              class="alert alert-warning small py-2 mt-2 mb-0"
            >
              <i class="bi bi-exclamation-triangle me-1"></i>
              <strong>rar</strong> not found on PATH. Usenet uploads will fail.
              See the
              <a
                href="https://github.com/albinmedoc/webDL-webUI#rar-licensing"
                target="_blank"
                rel="noopener noreferrer"
              >RAR licensing notes</a> for install steps.
            </div>
          </div>

          <div class="d-flex gap-2 flex-wrap mb-2">
            <button
              class="btn btn-outline-primary btn-sm"
              :disabled="!config.enabled || !config.host || nntpTesting"
              @click="testNntp"
            >
              <i class="bi" :class="nntpTesting ? 'bi-arrow-clockwise' : 'bi-broadcast-pin'"></i>
              {{ nntpTesting ? 'Testing…' : 'Test NNTP' }}
            </button>
            <button
              class="btn btn-outline-primary btn-sm"
              :disabled="!config.enabled || !config.indexer.hookScriptSet || indexerTesting"
              @click="testIndexer"
            >
              <i class="bi" :class="indexerTesting ? 'bi-arrow-clockwise' : 'bi-play-circle'"></i>
              {{ indexerTesting ? 'Testing…' : 'Test indexer hook' }}
            </button>
          </div>

          <div v-if="nntpResult" class="alert alert-sm py-2 small" :class="nntpResult.ok ? 'alert-success' : 'alert-danger'">
            <div>
              <i class="bi me-1" :class="nntpResult.ok ? 'bi-check-circle' : 'bi-x-circle'"></i>
              <strong>NNTP:</strong>
              {{ nntpResult.ok ? 'connected & authenticated' : (nntpResult.error || 'failed') }}
              <span class="text-muted">({{ nntpResult.durationMs }} ms)</span>
            </div>
            <div v-if="nntpResult.banner" class="mt-1"><code>{{ nntpResult.banner }}</code></div>
            <div v-if="nntpResult.groupResponse" class="mt-1"><code>{{ nntpResult.groupResponse }}</code></div>
          </div>

          <div v-if="indexerResult" class="alert alert-sm py-2 small" :class="indexerResult.ok ? 'alert-success' : 'alert-danger'">
            <div>
              <i class="bi me-1" :class="indexerResult.ok ? 'bi-check-circle' : 'bi-x-circle'"></i>
              <strong>Indexer hook --check:</strong>
              {{ indexerResult.ok ? 'OK' : (indexerResult.error || `exit ${indexerResult.exitCode}`) }}
            </div>
            <pre v-if="indexerResult.stdout" class="mb-0 mt-1 small bg-dark text-info p-2 rounded" style="white-space: pre-wrap;">{{ indexerResult.stdout }}</pre>
            <pre v-if="indexerResult.stderr" class="mb-0 mt-1 small bg-dark text-warning p-2 rounded" style="white-space: pre-wrap;">{{ indexerResult.stderr }}</pre>
          </div>
        </div>
      </div>

      <div class="card-footer text-end">
        <button class="btn btn-secondary btn-sm" @click="$emit('close')">Close</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useUsenetStore } from '../stores/usenetStore'

interface UsenetConfigPublic {
  enabled: boolean
  host: string
  port: number
  ssl: boolean
  user: string
  passSet: boolean
  connections: number
  groups: string[]
  par2Percent: number
  rarSizeMb: number
  maxConcurrent: number
  minFreeDiskMultiplier: number
  subjectTemplate: string
  nfoPath: string | null
  nyuuExtraArgs: string[]
  indexer: {
    hookScriptSet: boolean
    nzbOutputDir: string
  }
}

interface NntpResult {
  ok: boolean
  banner?: string
  authResponse?: string
  groupResponse?: string
  error?: string
  durationMs: number
}

interface IndexerResult {
  ok: boolean
  exitCode?: number | null
  signal?: string | null
  stdout?: string
  stderr?: string
  error?: string
}

defineEmits<{ (e: 'close'): void }>()

const usenetStore = useUsenetStore()

const toolList = computed(() => {
  const t = usenetStore.tools
  if (!t) return []
  return [
    { name: 'rar', present: t.rar },
    { name: 'parpar', present: t.parpar },
    { name: 'nyuu', present: t.nyuu },
  ]
})

const config = ref<UsenetConfigPublic | null>(null)
const loading = ref(true)
const loadError = ref<string | null>(null)

const nntpTesting = ref(false)
const nntpResult = ref<NntpResult | null>(null)

const indexerTesting = ref(false)
const indexerResult = ref<IndexerResult | null>(null)

async function loadConfig() {
  loading.value = true
  loadError.value = null
  try {
    const res = await fetch('/api/usenet/config')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    config.value = await res.json()
  } catch (err) {
    loadError.value = (err as Error).message
  } finally {
    loading.value = false
  }
}

async function testNntp() {
  nntpTesting.value = true
  nntpResult.value = null
  try {
    const res = await fetch('/api/usenet/test/nntp', { method: 'POST' })
    nntpResult.value = await res.json()
  } catch (err) {
    nntpResult.value = { ok: false, error: (err as Error).message, durationMs: 0 }
  } finally {
    nntpTesting.value = false
  }
}

async function testIndexer() {
  indexerTesting.value = true
  indexerResult.value = null
  try {
    const res = await fetch('/api/usenet/test/indexer', { method: 'POST' })
    indexerResult.value = await res.json()
  } catch (err) {
    indexerResult.value = { ok: false, error: (err as Error).message }
  } finally {
    indexerTesting.value = false
  }
}

onMounted(() => {
  loadConfig()
  usenetStore.fetchTools()
})
</script>

<style scoped>
.modal-backdrop-custom {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 1050;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 2rem 1rem;
  overflow-y: auto;
}
.modal-dialog-custom {
  max-width: 720px;
  width: 100%;
}
.table th {
  width: 40%;
  font-weight: 500;
  color: #6c757d;
}
</style>
