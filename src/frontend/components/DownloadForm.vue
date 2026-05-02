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
            @blur="onUrlBlur"
            type="url"
            required
            placeholder="https://www.svtplay.se/video/..."
            class="form-control form-control-lg"
          />
        </div>

        <!-- Quality (auto-probed) -->
        <div class="mb-4">
          <label class="form-label fw-semibold d-flex align-items-center">
            <i class="bi bi-camera-video me-1"></i>
            Quality
            <span v-if="downloadStore.probe.loading" class="ms-2 small text-muted">
              <span class="spinner-border spinner-border-sm me-1" role="status"></span>
              Probing…
            </span>
          </label>

          <div v-if="downloadStore.probe.error" class="alert alert-warning small py-2 mb-2">
            <i class="bi bi-exclamation-triangle me-1"></i>
            Could not list qualities: {{ downloadStore.probe.error }}. Submitting will
            download the best available stream.
          </div>

          <div v-if="availableHeights.length > 0" class="d-flex flex-wrap gap-2">
            <div
              v-for="height in availableHeights"
              :key="height"
              class="form-check form-check-inline"
            >
              <input
                :id="`q-${height}`"
                type="checkbox"
                class="form-check-input"
                :value="height"
                v-model="downloadStore.selectedResolutions"
              />
              <label :for="`q-${height}`" class="form-check-label">
                {{ height }}p
              </label>
            </div>
            <div class="form-text w-100">
              Tick none → best available. Tick multiple → one download per quality.
            </div>
          </div>

          <div
            v-else-if="!downloadStore.probe.loading && !downloadStore.probe.error"
            class="form-text"
          >
            Paste a video URL to load available qualities. Submitting without a probe
            downloads the best available stream.
          </div>
        </div>

        <!-- Episodes -->
        <div class="mb-4">
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

        <!-- Token -->
        <div class="mb-4">
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
          <button
            type="submit"
            :disabled="!url || isSubmitting"
            class="btn btn-primary"
          >
            <i class="bi" :class="isSubmitting ? 'bi-arrow-clockwise' : 'bi-download'"></i>
            {{ isSubmitting ? 'Adding...' : 'Add Download' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useDownloadStore } from '../stores/downloadStore'
import { useUsenetStore } from '../stores/usenetStore'

const downloadStore = useDownloadStore()
const usenetStore = useUsenetStore()

const url = ref('')
const isSubmitting = ref(false)

const availableHeights = computed(() => downloadStore.probe.heights ?? [])

// Lazily warm tool availability so the rar-missing warning can render.
watch(
  () => usenetStore.enabled,
  (enabled) => {
    if (enabled) usenetStore.fetchTools()
  },
  { immediate: true },
)

// Reset probe state whenever the user edits the URL away from the probed one.
watch(url, (next) => {
  if (downloadStore.probe.url && downloadStore.probe.url !== next) {
    downloadStore.resetProbe()
  }
})

const onUrlBlur = () => {
  if (!url.value) return
  void downloadStore.probeUrl(url.value)
}

const emit = defineEmits<{ submitted: [] }>()

const handleSubmit = async () => {
  if (!url.value) return

  isSubmitting.value = true
  try {
    await downloadStore.addDownloadJob(url.value)
    url.value = ''
    downloadStore.resetProbe()
    emit('submitted')
  } catch (error) {
    console.error('Failed to add download:', error)
  } finally {
    isSubmitting.value = false
  }
}
</script>
