<template>
  <div class="card shadow-sm">
    <div class="card-header bg-primary text-white">
      <h5 class="card-title mb-0">
        <i class="bi bi-plus-circle me-2"></i>
        Add Download
      </h5>
    </div>

    <div class="card-body">
      <form @submit.prevent="handleSubmit">
        <!-- URL Input -->
        <div class="mb-4">
          <label for="url" class="form-label fw-semibold">
            <i class="bi bi-link-45deg me-1"></i>
            Video URL *
          </label>
          <input
            id="url"
            v-model="url"
            type="url"
            required
            placeholder="https://www.svtplay.se/video/..."
            class="form-control form-control-lg"
          />
        </div>

        <!-- Quick Options -->
        <div class="row mb-4">
          <div class="col-md-6 mb-3">
            <div class="form-check">
              <input
                id="allEpisodes"
                v-model="downloadStore.currentOptions.allEpisodes"
                type="checkbox"
                class="form-check-input"
              />
              <label for="allEpisodes" class="form-check-label">
                <i class="bi bi-collection-play me-1"></i>
                Download all episodes
              </label>
            </div>
          </div>

          <div class="col-md-6 mb-3">
            <div class="form-check">
              <input
                id="subfolder"
                v-model="downloadStore.currentOptions.subfolder"
                type="checkbox"
                class="form-check-input"
              />
              <label for="subfolder" class="form-check-label">
                <i class="bi bi-folder-plus me-1"></i>
                Create subfolder
              </label>
            </div>
          </div>
        </div>

        <!-- Usenet Auto-post (only when backend feature flag is on) -->
        <div v-if="usenetStore.enabled" class="mb-4">
          <div class="card border-light">
            <div class="card-body py-3">
              <div class="form-check">
                <input
                  id="autoPostUsenet"
                  v-model="downloadStore.currentOptions.autoPostUsenet"
                  type="checkbox"
                  class="form-check-input"
                />
                <label for="autoPostUsenet" class="form-check-label fw-semibold">
                  <i class="bi bi-cloud-upload me-1"></i>
                  Auto-post to Usenet after download
                </label>
              </div>
              <div
                v-if="
                  downloadStore.currentOptions.autoPostUsenet &&
                  usenetStore.tools &&
                  !usenetStore.tools.rar
                "
                class="alert alert-warning small py-2 mt-3 mb-0"
              >
                <i class="bi bi-exclamation-triangle me-1"></i>
                <strong>rar</strong> not found on the server — the upload will fail at
                the archiving step. Open Settings for install steps.
              </div>
            </div>
          </div>
        </div>

        <!-- Quality and Format Selection -->
        <div class="row mb-4">
          <div class="col-md-6 mb-3">
            <label for="quality" class="form-label fw-semibold">
              <i class="bi bi-camera-video me-1"></i>
              Quality
            </label>
            <select
              id="quality"
              v-model="downloadStore.currentOptions.quality"
              class="form-select"
            >
              <option value="">Best available</option>
              <option value="720">720p</option>
              <option value="1080">1080p</option>
              <option value="480">480p</option>
              <option value="360">360p</option>
            </select>
          </div>

          <div class="col-md-6 mb-3">
            <label for="outputFormat" class="form-label fw-semibold">
              <i class="bi bi-file-earmark-code me-1"></i>
              Output Format
            </label>
            <select
              id="outputFormat"
              v-model="downloadStore.currentOptions.outputFormat"
              class="form-select"
            >
              <option value="mp4">MP4</option>
              <option value="mkv">MKV</option>
            </select>
          </div>
        </div>

        <!-- Output Directory and Token -->
        <div class="row mb-4">
          <div class="col-md-6 mb-3">
            <label for="output" class="form-label fw-semibold">
              <i class="bi bi-folder me-1"></i>
              Output Directory <small class="text-muted">(optional)</small>
            </label>
            <input
              id="output"
              v-model="downloadStore.currentOptions.output"
              type="text"
              placeholder="/path/to/downloads"
              class="form-control"
            />
          </div>

          <div class="col-md-6 mb-3">
            <label for="token" class="form-label fw-semibold">
              <i class="bi bi-key me-1"></i>
              Token <small class="text-muted">(optional)</small>
            </label>
            <input
              id="token"
              v-model="downloadStore.currentOptions.token"
              type="password"
              placeholder="Authentication token"
              class="form-control"
            />
            <div class="form-text">
              Authentication token for services that require it
            </div>
          </div>
        </div>

        <!-- Username and Password (optional, for premium content) -->
        <div class="row mb-4">
          <div class="col-md-6 mb-3">
            <label for="username" class="form-label fw-semibold">
              <i class="bi bi-person me-1"></i>
              Username <small class="text-muted">(optional)</small>
            </label>
            <input
              id="username"
              v-model="downloadStore.currentOptions.username"
              type="text"
              autocomplete="username"
              class="form-control"
            />
          </div>

          <div class="col-md-6 mb-3">
            <label for="password" class="form-label fw-semibold">
              <i class="bi bi-shield-lock me-1"></i>
              Password <small class="text-muted">(optional)</small>
            </label>
            <input
              id="password"
              v-model="downloadStore.currentOptions.password"
              type="password"
              autocomplete="current-password"
              class="form-control"
            />
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="d-flex justify-content-end">
          <div class="btn-group">
            <button
              type="button"
              @click="listQuality"
              :disabled="!url || isSubmitting"
              class="btn btn-outline-primary"
            >
              <i class="bi bi-list-check me-1"></i>
              List Quality
            </button>

            <button
              type="submit"
              :disabled="!url || isSubmitting"
              class="btn btn-primary"
            >
              <i class="bi" :class="isSubmitting ? 'bi-arrow-clockwise' : 'bi-download'"></i>
              {{ isSubmitting ? 'Adding...' : 'Add Download' }}
            </button>
          </div>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useDownloadStore } from '../stores/downloadStore'
import { useUsenetStore } from '../stores/usenetStore'

const downloadStore = useDownloadStore()
const usenetStore = useUsenetStore()

const url = ref('')
const isSubmitting = ref(false)

// Lazily warm tool availability so the rar-missing warning can render.
watch(
  () => usenetStore.enabled,
  (enabled) => {
    if (enabled) usenetStore.fetchTools()
  },
  { immediate: true },
)

const handleSubmit = async () => {
  if (!url.value) return

  isSubmitting.value = true
  try {
    await downloadStore.addDownloadJob(url.value)
    url.value = '' // Clear the URL after successful submission
  } catch (error) {
    console.error('Failed to add download:', error)
  } finally {
    isSubmitting.value = false
  }
}

const listQuality = async () => {
  if (!url.value) return

  isSubmitting.value = true
  try {
    // Create a temporary options object with listQuality enabled
    const options = { ...downloadStore.currentOptions, listQuality: true }
    await downloadStore.addDownloadJob(url.value, options)
  } catch (error) {
    console.error('Failed to list quality:', error)
  } finally {
    isSubmitting.value = false
  }
}
</script>
