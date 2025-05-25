<template>
  <div class="card shadow-sm">
    <div class="card-header bg-info text-white">
      <h5 class="card-title mb-0">
        <i class="bi bi-sliders me-2"></i>
        Advanced Options
      </h5>
    </div>

    <div class="card-body">
      <div class="accordion" id="optionsAccordion">
        <!-- Subtitle Options -->
        <div class="accordion-item">
          <h2 class="accordion-header" id="subtitleHeading">
            <button class="accordion-button" type="button" data-bs-toggle="collapse" data-bs-target="#subtitleCollapse" aria-expanded="true" aria-controls="subtitleCollapse">
              <i class="bi bi-chat-square-text me-2"></i>
              Subtitle Options
            </button>
          </h2>
          <div id="subtitleCollapse" class="accordion-collapse collapse show" aria-labelledby="subtitleHeading" data-bs-parent="#optionsAccordion">
            <div class="accordion-body">
              <div class="row g-3">
                <div class="col-md-4">
                  <div class="form-check">
                    <input
                      id="mergeSubtitle"
                      v-model="downloadStore.currentOptions.mergeSubtitle"
                      type="checkbox"
                      class="form-check-input"
                    />
                    <label for="mergeSubtitle" class="form-check-label">
                      <i class="bi bi-layers me-1"></i>
                      Merge subtitles
                    </label>
                  </div>
                </div>
                
                <div class="col-md-4">
                  <div class="form-check">
                    <input
                      id="allSubtitles"
                      v-model="downloadStore.currentOptions.allSubtitles"
                      type="checkbox"
                      class="form-check-input"
                    />
                    <label for="allSubtitles" class="form-check-label">
                      <i class="bi bi-collection me-1"></i>
                      All subtitles
                    </label>
                  </div>
                </div>
                
                <div class="col-md-4">
                  <div class="form-check">
                    <input
                      id="rawSubtitles"
                      v-model="downloadStore.currentOptions.rawSubtitles"
                      type="checkbox"
                      class="form-check-input"
                    />
                    <label for="rawSubtitles" class="form-check-label">
                      <i class="bi bi-file-earmark-text me-1"></i>
                      Raw subtitles
                    </label>
                  </div>
                </div>
                
                <div class="col-md-4">
                  <div class="form-check">
                    <input
                      id="forceSubtitle"
                      v-model="downloadStore.currentOptions.forceSubtitle"
                      type="checkbox"
                      class="form-check-input"
                    />
                    <label for="forceSubtitle" class="form-check-label">
                      <i class="bi bi-exclamation-circle me-1"></i>
                      Force subtitle only
                    </label>
                  </div>
                </div>
                
                <div class="col-md-4">
                  <div class="form-check">
                    <input
                      id="requireSubtitle"
                      v-model="downloadStore.currentOptions.requireSubtitle"
                      type="checkbox"
                      class="form-check-input"
                    />
                    <label for="requireSubtitle" class="form-check-label">
                      <i class="bi bi-check-circle me-1"></i>
                      Require subtitle
                    </label>
                  </div>
                </div>
                
                <div class="col-md-4">
                  <div class="form-check">
                    <input
                      id="convertSubtitleColors"
                      v-model="downloadStore.currentOptions.convertSubtitleColors"
                      type="checkbox"
                      class="form-check-input"
                    />
                    <label for="convertSubtitleColors" class="form-check-label">
                      <i class="bi bi-palette me-1"></i>
                      Convert colors
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Quality & Format Options -->
        <div class="accordion-item">
          <h2 class="accordion-header" id="qualityHeading">
            <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#qualityCollapse" aria-expanded="false" aria-controls="qualityCollapse">
              <i class="bi bi-camera-video me-2"></i>
              Quality & Format Options
            </button>
          </h2>
          <div id="qualityCollapse" class="accordion-collapse collapse" aria-labelledby="qualityHeading" data-bs-parent="#optionsAccordion">
            <div class="accordion-body">
              <div class="row g-3">
                <div class="col-md-4">
                  <label for="flexibleQuality" class="form-label">
                    <i class="bi bi-arrows-angle-expand me-1"></i>
                    Flexible Quality (±)
                  </label>
                  <input
                    id="flexibleQuality"
                    v-model.number="downloadStore.currentOptions.flexibleQuality"
                    type="number"
                    min="0"
                    placeholder="0"
                    class="form-control form-control-sm"
                  />
                </div>
                
                <div class="col-md-4">
                  <label for="resolution" class="form-label">
                    <i class="bi bi-display me-1"></i>
                    Resolution (comma separated)
                  </label>
                  <input
                    id="resolution"
                    v-model="downloadStore.currentOptions.resolution"
                    type="text"
                    placeholder="480,720,1080"
                    class="form-control form-control-sm"
                  />
                </div>
                
                <div class="col-md-4">
                  <label for="audioLanguage" class="form-label">
                    <i class="bi bi-translate me-1"></i>
                    Audio Language
                  </label>
                  <input
                    id="audioLanguage"
                    v-model="downloadStore.currentOptions.audioLanguage"
                    type="text"
                    placeholder="sv, en, etc."
                    class="form-control form-control-sm"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Download Options -->
        <div class="accordion-item">
          <h2 class="accordion-header" id="downloadHeading">
            <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#downloadCollapse" aria-expanded="false" aria-controls="downloadCollapse">
              <i class="bi bi-download me-2"></i>
              Download Options
            </button>
          </h2>
          <div id="downloadCollapse" class="accordion-collapse collapse" aria-labelledby="downloadHeading" data-bs-parent="#optionsAccordion">
            <div class="accordion-body">
              <div class="row g-3">
                <div class="col-md-4">
                  <div class="form-check">
                    <input
                      id="force"
                      v-model="downloadStore.currentOptions.force"
                      type="checkbox"
                      class="form-check-input"
                    />
                    <label for="force" class="form-check-label">
                      <i class="bi bi-arrow-clockwise me-1"></i>
                      Force overwrite
                    </label>
                  </div>
                </div>
                
                <div class="col-md-4">
                  <div class="form-check">
                    <input
                      id="onlyAudio"
                      v-model="downloadStore.currentOptions.onlyAudio"
                      type="checkbox"
                      class="form-check-input"
                    />
                    <label for="onlyAudio" class="form-check-label">
                      <i class="bi bi-music-note me-1"></i>
                      Audio only
                    </label>
                  </div>
                </div>
                
                <div class="col-md-4">
                  <div class="form-check">
                    <input
                      id="onlyVideo"
                      v-model="downloadStore.currentOptions.onlyVideo"
                      type="checkbox"
                      class="form-check-input"
                    />
                    <label for="onlyVideo" class="form-check-label">
                      <i class="bi bi-camera-video me-1"></i>
                      Video only
                    </label>
                  </div>
                </div>
                
                <div class="col-md-4">
                  <div class="form-check">
                    <input
                      id="getUrl"
                      v-model="downloadStore.currentOptions.getUrl"
                      type="checkbox"
                      class="form-check-input"
                    />
                    <label for="getUrl" class="form-check-label">
                      <i class="bi bi-link me-1"></i>
                      Get URL only
                    </label>
                  </div>
                </div>
                
                <div class="col-md-4">
                  <div class="form-check">
                    <input
                      id="includeClips"
                      v-model="downloadStore.currentOptions.includeClips"
                      type="checkbox"
                      class="form-check-input"
                    />
                    <label for="includeClips" class="form-check-label">
                      <i class="bi bi-scissors me-1"></i>
                      Include clips
                    </label>
                  </div>
                </div>
                
                <div class="col-md-4">
                  <div class="form-check">
                    <input
                      id="reverse"
                      v-model="downloadStore.currentOptions.reverse"
                      type="checkbox"
                      class="form-check-input"
                    />
                    <label for="reverse" class="form-check-label">
                      <i class="bi bi-arrow-up-down me-1"></i>
                      Reverse order
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Post-processing Options -->
        <div class="accordion-item">
          <h2 class="accordion-header" id="postProcessHeading">
            <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#postProcessCollapse" aria-expanded="false" aria-controls="postProcessCollapse">
              <i class="bi bi-gear me-2"></i>
              Post-processing Options
            </button>
          </h2>
          <div id="postProcessCollapse" class="accordion-collapse collapse" aria-labelledby="postProcessHeading" data-bs-parent="#optionsAccordion">
            <div class="accordion-body">
              <div class="row g-3">
                <div class="col-md-4">
                  <div class="form-check">
                    <input
                      id="noRemux"
                      v-model="downloadStore.currentOptions.noRemux"
                      type="checkbox"
                      class="form-check-input"
                    />
                    <label for="noRemux" class="form-check-label">
                      <i class="bi bi-x-circle me-1"></i>
                      No remux
                    </label>
                  </div>
                </div>
                
                <div class="col-md-4">
                  <div class="form-check">
                    <input
                      id="noMerge"
                      v-model="downloadStore.currentOptions.noMerge"
                      type="checkbox"
                      class="form-check-input"
                    />
                    <label for="noMerge" class="form-check-label">
                      <i class="bi bi-x-circle me-1"></i>
                      No merge
                    </label>
                  </div>
                </div>
                
                <div class="col-md-4">
                  <div class="form-check">
                    <input
                      id="noPostprocess"
                      v-model="downloadStore.currentOptions.noPostprocess"
                      type="checkbox"
                      class="form-check-input"
                    />
                    <label for="noPostprocess" class="form-check-label">
                      <i class="bi bi-x-circle me-1"></i>
                      No post-process
                    </label>
                  </div>
                </div>
                
                <div class="col-md-4">
                  <div class="form-check">
                    <input
                      id="keepOriginal"
                      v-model="downloadStore.currentOptions.keepOriginal"
                      type="checkbox"
                      class="form-check-input"
                    />
                    <label for="keepOriginal" class="form-check-label">
                      <i class="bi bi-archive me-1"></i>
                      Keep original
                    </label>
                  </div>
                </div>
                
                <div class="col-md-4">
                  <div class="form-check">
                    <input
                      id="chapters"
                      v-model="downloadStore.currentOptions.chapters"
                      type="checkbox"
                      class="form-check-input"
                    />
                    <label for="chapters" class="form-check-label">
                      <i class="bi bi-bookmark me-1"></i>
                      Add chapters
                    </label>
                  </div>
                </div>
                
                <div class="col-md-4">
                  <div class="form-check">
                    <input
                      id="nfo"
                      v-model="downloadStore.currentOptions.nfo"
                      type="checkbox"
                      class="form-check-input"
                    />
                    <label for="nfo" class="form-check-label">
                      <i class="bi bi-file-earmark-text me-1"></i>
                      Create NFO
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Advanced Fields -->
        <div class="accordion-item">
          <h2 class="accordion-header" id="advancedHeading">
            <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#advancedCollapse" aria-expanded="false" aria-controls="advancedCollapse">
              <i class="bi bi-tools me-2"></i>
              Advanced Fields
            </button>
          </h2>
          <div id="advancedCollapse" class="accordion-collapse collapse" aria-labelledby="advancedHeading" data-bs-parent="#optionsAccordion">
            <div class="accordion-body">
              <div class="row g-3">
                <div class="col-md-6">
                  <label for="filename" class="form-label">
                    <i class="bi bi-file-earmark me-1"></i>
                    Filename Format
                  </label>
                  <input
                    id="filename"
                    v-model="downloadStore.currentOptions.filename"
                    type="text"
                    placeholder="{title}.s{season}e{episode}.{episodename}-{id}-{service}.{ext}"
                    class="form-control form-control-sm"
                  />
                </div>
                
                <div class="col-md-6">
                  <label for="proxy" class="form-label">
                    <i class="bi bi-shield me-1"></i>
                    Proxy
                  </label>
                  <input
                    id="proxy"
                    v-model="downloadStore.currentOptions.proxy"
                    type="text"
                    placeholder="http://proxy:port"
                    class="form-control form-control-sm"
                  />
                </div>
                
                <div class="col-md-6">
                  <label for="afterDate" class="form-label">
                    <i class="bi bi-calendar me-1"></i>
                    After Date
                  </label>
                  <input
                    id="afterDate"
                    v-model="downloadStore.currentOptions.afterDate"
                    type="date"
                    class="form-control form-control-sm"
                  />
                </div>
                
                <div class="col-md-6">
                  <label for="allLast" class="form-label">
                    <i class="bi bi-arrow-counterclockwise me-1"></i>
                    Last N Episodes
                  </label>
                  <input
                    id="allLast"
                    v-model.number="downloadStore.currentOptions.allLast"
                    type="number"
                    min="1"
                    placeholder="e.g., 5"
                    class="form-control form-control-sm"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Logging Options -->
        <div class="accordion-item">
          <h2 class="accordion-header" id="loggingHeading">
            <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#loggingCollapse" aria-expanded="false" aria-controls="loggingCollapse">
              <i class="bi bi-journal-text me-2"></i>
              Logging Options
            </button>
          </h2>
          <div id="loggingCollapse" class="accordion-collapse collapse" aria-labelledby="loggingHeading" data-bs-parent="#optionsAccordion">
            <div class="accordion-body">
              <div class="row g-3">
                <div class="col-md-4">
                  <div class="form-check">
                    <input
                      id="silent"
                      v-model="downloadStore.currentOptions.silent"
                      type="checkbox"
                      class="form-check-input"
                    />
                    <label for="silent" class="form-check-label">
                      <i class="bi bi-volume-mute me-1"></i>
                      Silent
                    </label>
                  </div>
                </div>
                
                <div class="col-md-4">
                  <div class="form-check">
                    <input
                      id="verbose"
                      v-model="downloadStore.currentOptions.verbose"
                      type="checkbox"
                      class="form-check-input"
                    />
                    <label for="verbose" class="form-check-label">
                      <i class="bi bi-volume-up me-1"></i>
                      Verbose
                    </label>
                  </div>
                </div>
                
                <div class="col-md-4">
                  <div class="form-check">
                    <input
                      id="dontVerifySslCert"
                      v-model="downloadStore.currentOptions.dontVerifySslCert"
                      type="checkbox"
                      class="form-check-input"
                    />
                    <label for="dontVerifySslCert" class="form-check-label">
                      <i class="bi bi-shield-x me-1"></i>
                      Don't verify SSL
                    </label>
                  </div>
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
import { useDownloadStore } from '../stores/downloadStore'

const downloadStore = useDownloadStore()
</script>
