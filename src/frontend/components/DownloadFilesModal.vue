<template>
  <Teleport to="body">
    <div class="modal-backdrop-custom" @click.self="$emit('close')">
      <div class="modal-dialog-custom card shadow-lg">
        <div class="card-header bg-success text-white d-flex justify-content-between align-items-center gap-2">
          <div class="d-flex flex-column min-w-0">
            <div class="fw-semibold">
              <i class="bi bi-folder2-open me-2"></i>
              Downloaded files
              <span class="badge bg-light text-dark ms-2">{{ job?.files.length ?? 0 }}</span>
            </div>
            <small class="text-truncate text-light-emphasis" :title="job?.url">
              {{ job?.url || '—' }}
            </small>
          </div>
          <button
            type="button"
            class="btn-close btn-close-white flex-shrink-0"
            @click="$emit('close')"
            aria-label="Close"
          ></button>
        </div>

        <div class="card-body p-0" style="max-height: 70vh; overflow-y: auto;">
          <div v-if="!job" class="p-3 text-muted">Job not found.</div>
          <div v-else-if="job.files.length === 0" class="p-3 text-muted">
            No files recorded for this job.
          </div>
          <div v-else>
            <div v-if="job.outputDir" class="px-3 pt-3 small text-muted text-break">
              <i class="bi bi-folder me-1"></i>
              {{ job.outputDir }}
            </div>
            <ul class="list-group list-group-flush mt-2">
              <li
                v-for="(file, idx) in job.files"
                :key="`${file.path}-${idx}`"
                class="list-group-item d-flex align-items-center gap-2"
              >
                <i class="bi bi-file-earmark-play text-muted flex-shrink-0"></i>
                <div class="flex-grow-1 min-w-0">
                  <div class="text-break fw-semibold small">{{ basename(file.path) }}</div>
                  <div
                    class="text-muted small text-break"
                    :title="file.path"
                  >
                    {{ file.path }}
                  </div>
                </div>
                <span class="badge bg-light text-dark border flex-shrink-0">
                  {{ formatSize(file.size) }}
                </span>
                <a
                  class="btn btn-outline-success btn-sm flex-shrink-0"
                  :href="downloadHref(file.path)"
                  :download="basename(file.path)"
                  title="Download file"
                >
                  <i class="bi bi-download"></i>
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div class="card-footer d-flex justify-content-end">
          <button class="btn btn-sm btn-outline-secondary" @click="$emit('close')">
            Close
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useDownloadStore } from '../stores/downloadStore'

const props = defineProps<{ jobId: string }>()
defineEmits<{ close: [] }>()

const downloadStore = useDownloadStore()
const job = computed(() => downloadStore.jobs.find((j) => j.id === props.jobId))

function basename(p: string): string {
  const parts = p.split(/[\\/]/)
  return parts[parts.length - 1] || p
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`
}

function downloadHref(filePath: string): string {
  return `/api/downloads/jobs/${encodeURIComponent(props.jobId)}/files/download?path=${encodeURIComponent(filePath)}`
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
