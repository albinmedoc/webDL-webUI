<template>
  <div class="modal-backdrop-custom" @click.self="$emit('close')">
    <div class="modal-dialog-custom card shadow-lg">
      <div class="card-header bg-primary text-white d-flex justify-content-between align-items-center">
        <h5 class="mb-0">
          <i class="bi bi-gear me-2"></i>
          Settings
        </h5>
        <button class="btn-close btn-close-white" aria-label="Close" @click="$emit('close')"></button>
      </div>

      <div class="card-body">
        <div v-if="loading" class="text-center py-4 text-muted">
          <div class="spinner-border" role="status"></div>
          <div class="mt-2">Loading settings…</div>
        </div>

        <div v-else-if="loadError" class="alert alert-danger small">
          <i class="bi bi-exclamation-triangle me-1"></i>
          {{ loadError }}
        </div>

        <div v-else>
          <p class="small text-muted">
            Values pinned by environment variables can't be edited here — they
            override anything set in the UI.
          </p>

          <div v-for="group in groupOrder" :key="group.id">
            <h6 class="text-primary mt-3 mb-2">
              <i class="bi me-1" :class="group.icon"></i>
              {{ group.label }}
            </h6>
            <table class="table table-sm align-middle">
              <tbody>
                <tr v-for="setting in settingsByGroup[group.id]" :key="setting.key">
                  <th class="setting-label">
                    {{ humanise(setting.key) }}
                    <div class="text-muted env-var">
                      <code>{{ setting.envVar }}</code>
                      <i v-if="setting.lockedByEnv" class="bi bi-lock-fill ms-1" title="Pinned by environment variable"></i>
                    </div>
                  </th>
                  <td>
                    <input
                      v-if="setting.kind !== 'list' && setting.kind !== 'shellArgs' && setting.kind !== 'boolean'"
                      :type="setting.sensitive ? 'password' : (setting.kind === 'integer' || setting.kind === 'float' ? 'number' : 'text')"
                      class="form-control form-control-sm"
                      :placeholder="setting.sensitive && setting.value === '__SET__' ? '(unchanged — leave blank to keep)' : String(setting.default ?? '')"
                      :disabled="setting.lockedByEnv"
                      :value="setting.sensitive && setting.value === '__SET__' ? '' : (getDraft(setting) as string | number)"
                      @input="onInput(setting, ($event.target as HTMLInputElement).value)"
                    />

                    <div v-else-if="setting.kind === 'boolean'" class="form-check form-switch">
                      <input
                        class="form-check-input"
                        type="checkbox"
                        :disabled="setting.lockedByEnv"
                        :checked="!!getDraft(setting)"
                        @change="onBoolean(setting, ($event.target as HTMLInputElement).checked)"
                      />
                    </div>

                    <input
                      v-else
                      type="text"
                      class="form-control form-control-sm"
                      :placeholder="(setting.default as string[]).join(setting.kind === 'list' ? ', ' : ' ')"
                      :disabled="setting.lockedByEnv"
                      :value="(getDraft(setting) as string[] | undefined)?.join(setting.kind === 'list' ? ', ' : ' ') ?? ''"
                      @input="onListLike(setting, ($event.target as HTMLInputElement).value)"
                    />
                  </td>
                  <td class="setting-actions">
                    <button
                      v-if="!setting.lockedByEnv && hasDraft(setting)"
                      class="btn btn-link btn-sm p-0 text-muted"
                      title="Discard change"
                      @click="discardDraft(setting)"
                    >
                      <i class="bi bi-arrow-counterclockwise"></i>
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="d-flex gap-2 mt-3">
            <button
              class="btn btn-primary btn-sm"
              :disabled="!hasAnyDraft || saving"
              @click="save"
            >
              <i class="bi" :class="saving ? 'bi-arrow-clockwise' : 'bi-save'"></i>
              {{ saving ? 'Saving…' : 'Save changes' }}
            </button>
            <button
              class="btn btn-outline-secondary btn-sm"
              :disabled="!hasAnyDraft || saving"
              @click="discardAll"
            >
              Discard all
            </button>
            <span v-if="saveResult" class="ms-2 small align-self-center" :class="saveResult.ok ? 'text-success' : 'text-danger'">
              <i class="bi me-1" :class="saveResult.ok ? 'bi-check-circle' : 'bi-x-circle'"></i>
              {{ saveResult.message }}
            </span>
          </div>

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
            </div>
          </div>

          <div class="d-flex gap-2 flex-wrap mb-2">
            <button
              class="btn btn-outline-primary btn-sm"
              :disabled="!enabled || !hostSet || nntpTesting"
              @click="testNntp"
            >
              <i class="bi" :class="nntpTesting ? 'bi-arrow-clockwise' : 'bi-broadcast-pin'"></i>
              {{ nntpTesting ? 'Testing…' : 'Test NNTP' }}
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
        </div>
      </div>

      <div class="card-footer text-end">
        <button class="btn btn-secondary btn-sm" @click="$emit('close')">Close</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useUsenetStore } from '../stores/usenetStore'

interface Setting {
  key: string
  envVar: string
  group: string
  kind: 'string' | 'boolean' | 'integer' | 'float' | 'list' | 'shellArgs'
  value: unknown
  default: unknown
  lockedByEnv: boolean
  sensitive: boolean
}

interface SettingsResponse {
  settings: Setting[]
  passSet: boolean
}

interface NntpResult {
  ok: boolean
  banner?: string
  authResponse?: string
  groupResponse?: string
  error?: string
  durationMs: number
}

defineEmits<{ (e: 'close'): void }>()

const usenetStore = useUsenetStore()

const settings = ref<Setting[]>([])
const draft = reactive<Record<string, unknown>>({})
const loading = ref(true)
const loadError = ref<string | null>(null)

const saving = ref(false)
const saveResult = ref<{ ok: boolean; message: string } | null>(null)

const nntpTesting = ref(false)
const nntpResult = ref<NntpResult | null>(null)

const groupOrder = [
  { id: 'connection', label: 'Connection',     icon: 'bi-broadcast' },
  { id: 'archive',    label: 'Archive & PAR2', icon: 'bi-archive' },
  { id: 'subject',    label: 'Subject & nyuu', icon: 'bi-tag' },
  { id: 'release',    label: 'Release naming', icon: 'bi-file-text' },
  { id: 'workdir',    label: 'Work directory', icon: 'bi-folder' },
  { id: 'indexer',    label: 'Indexer hook',   icon: 'bi-search' },
  { id: 'download',   label: 'Download output', icon: 'bi-download' },
]

const settingsByGroup = computed(() => {
  const out: Record<string, Setting[]> = {}
  for (const g of groupOrder) out[g.id] = []
  for (const s of settings.value) (out[s.group] ??= []).push(s)
  return out
})

const enabled = computed(() => effective('enabled') === true)
const hostSet = computed(() => typeof effective('host') === 'string' && (effective('host') as string).length > 0)

const toolList = computed(() => {
  const t = usenetStore.tools
  if (!t) return []
  return [
    { name: 'rar', present: t.rar },
    { name: 'parpar', present: t.parpar },
    { name: 'nyuu', present: t.nyuu },
  ]
})

const hasAnyDraft = computed(() => Object.keys(draft).length > 0)

function effective(key: string): unknown {
  if (key in draft) return draft[key]
  return settings.value.find((s) => s.key === key)?.value
}

function getDraft(setting: Setting): unknown {
  return setting.key in draft ? draft[setting.key] : setting.value
}

function hasDraft(setting: Setting): boolean {
  return setting.key in draft
}

function discardDraft(setting: Setting): void {
  delete draft[setting.key]
}

function discardAll(): void {
  for (const k of Object.keys(draft)) delete draft[k]
}

function humanise(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/Mb$/i, 'MB')
}

function onInput(setting: Setting, raw: string): void {
  if (setting.kind === 'integer') {
    if (raw === '') {
      draft[setting.key] = setting.default
      return
    }
    const n = parseInt(raw, 10)
    if (Number.isFinite(n)) draft[setting.key] = n
  } else if (setting.kind === 'float') {
    if (raw === '') {
      draft[setting.key] = setting.default
      return
    }
    const n = parseFloat(raw)
    if (Number.isFinite(n)) draft[setting.key] = n
  } else if (setting.sensitive) {
    if (raw === '') {
      // Sensitive blank input means "no change" — drop the draft.
      delete draft[setting.key]
    } else {
      draft[setting.key] = raw
    }
  } else {
    draft[setting.key] = raw
  }
}

function onBoolean(setting: Setting, value: boolean): void {
  draft[setting.key] = value
}

function onListLike(setting: Setting, raw: string): void {
  const sep = setting.kind === 'list' ? ',' : /\s+/
  const parts = raw.split(sep as never).map((s) => s.trim()).filter(Boolean)
  draft[setting.key] = parts
}

async function loadSettings(): Promise<void> {
  loading.value = true
  loadError.value = null
  try {
    const res = await fetch('/api/settings')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as SettingsResponse
    settings.value = data.settings
  } catch (err) {
    loadError.value = (err as Error).message
  } finally {
    loading.value = false
  }
}

async function save(): Promise<void> {
  saving.value = true
  saveResult.value = null
  try {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const result = (await res.json()) as {
      applied: string[]
      rejected: { key: string; reason: string }[]
      settings: SettingsResponse
    }
    settings.value = result.settings.settings
    discardAll()
    if (result.rejected.length > 0) {
      saveResult.value = {
        ok: false,
        message: `Some keys rejected: ${result.rejected.map((r) => `${r.key} (${r.reason})`).join(', ')}`,
      }
    } else {
      saveResult.value = { ok: true, message: `Saved ${result.applied.length} setting${result.applied.length === 1 ? '' : 's'}` }
    }
    usenetStore.fetchHealth()
  } catch (err) {
    saveResult.value = { ok: false, message: (err as Error).message }
  } finally {
    saving.value = false
  }
}

async function testNntp(): Promise<void> {
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

onMounted(() => {
  loadSettings()
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
  max-width: 760px;
  width: 100%;
}
.setting-label {
  width: 38%;
  font-weight: 500;
  color: #495057;
}
.env-var {
  font-size: 0.75rem;
  font-weight: 400;
  margin-top: 2px;
}
.setting-actions {
  width: 32px;
  text-align: center;
}
</style>
