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
                id="subtitle"
                v-model="downloadStore.currentOptions.subtitle"
                type="checkbox"
                class="form-check-input"
              />
              <label for="subtitle" class="form-check-label">
                <i class="bi bi-chat-square-text me-1"></i>
                Download subtitles
              </label>
            </div>
          </div>
          
          <div class="col-md-6 mb-3">
            <div class="form-check">
              <input
                id="thumbnail"
                v-model="downloadStore.currentOptions.thumbnail"
                type="checkbox"
                class="form-check-input"
              />
              <label for="thumbnail" class="form-check-label">
                <i class="bi bi-image me-1"></i>
                Download thumbnail
              </label>
            </div>
          </div>
          
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

        <!-- Action Buttons -->
        <div class="d-flex justify-content-between align-items-center">
          <button
            type="button"
            @click="showAdvanced = !showAdvanced"
            class="btn btn-outline-secondary btn-sm"
          >
            <i class="bi" :class="showAdvanced ? 'bi-chevron-up' : 'bi-chevron-down'"></i>
            {{ showAdvanced ? 'Hide' : 'Show' }} Advanced Options
          </button>
          
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

      <!-- Advanced Options -->
      <div v-if="showAdvanced" class="mt-4 pt-4 border-top">
        <h6 class="text-primary mb-3">
          <i class="bi bi-gear me-1"></i>
          Advanced Options
        </h6>
        
        <div class="row">
          <!-- Authentication Section -->
          <div class="col-md-6">
            <div class="card border-light">
              <div class="card-body">
                <h6 class="card-title text-secondary">
                  <i class="bi bi-shield-lock me-1"></i>
                  Authentication
                </h6>
                
                <div class="mb-3">
                  <label for="username" class="form-label">Username</label>
                  <input
                    id="username"
                    v-model="downloadStore.currentOptions.username"
                    type="text"
                    class="form-control form-control-sm"
                  />
                </div>
                
                <div class="mb-3">
                  <label for="password" class="form-label">Password</label>
                  <input
                    id="password"
                    v-model="downloadStore.currentOptions.password"
                    type="password"
                    class="form-control form-control-sm"
                  />
                </div>
              </div>
            </div>
          </div>

          <!-- Stream Options Section -->
          <div class="col-md-6">
            <div class="card border-light">
              <div class="card-body">
                <h6 class="card-title text-secondary">
                  <i class="bi bi-broadcast me-1"></i>
                  Stream Options
                </h6>
                
                <div class="mb-3">
                  <label for="preferred" class="form-label">Preferred Method</label>
                  <select
                    id="preferred"
                    v-model="downloadStore.currentOptions.preferred"
                    class="form-select form-select-sm"
                  >
                    <option value="">Auto</option>
                    <option value="dash">DASH</option>
                    <option value="hls">HLS</option>
                    <option value="http">HTTP</option>
                  </select>
                </div>
                
                <div class="form-check">
                  <input
                    id="live"
                    v-model="downloadStore.currentOptions.live"
                    type="checkbox"
                    class="form-check-input"
                  />
                  <label for="live" class="form-check-label">
                    <i class="bi bi-broadcast-pin me-1"></i>
                    Live stream
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useDownloadStore } from '../stores/downloadStore'

const downloadStore = useDownloadStore()

const url = ref('')
const isSubmitting = ref(false)
const showAdvanced = ref(false)

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
