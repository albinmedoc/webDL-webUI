<template>
  <div class="min-vh-100 bg-light">
    <!-- Header -->
    <nav class="navbar navbar-expand-lg navbar-dark bg-primary shadow-sm">
      <div class="container-fluid">
        <a class="navbar-brand fw-bold fs-3" href="#">
          <i class="bi bi-download me-2"></i>
          SVTPlay-dl Web Interface
        </a>
        <div class="navbar-nav ms-auto">
          <span class="navbar-text">
            <i class="bi bi-activity me-1"></i>
            Active downloads: <span class="badge bg-light text-primary">{{ downloadStore.activeJobs.length }}</span>
          </span>
        </div>
      </div>
    </nav>

    <!-- Restoration Notice -->
    <div v-if="showRestorationNotice" class="alert alert-info alert-dismissible fade show m-0 rounded-0" role="alert">
      <div class="container-fluid">
        <i class="bi bi-info-circle me-2"></i>
        <strong>Downloads restored!</strong> {{ restoredJobsCount }} download(s) have been restored from your previous session.
        <button type="button" class="btn-close" aria-label="Close" @click="dismissRestorationNotice"></button>
      </div>
    </div>

    <!-- Main Content -->
    <main class="container-fluid py-4">
      <div class="row g-4">
        <!-- Download Form -->
        <div class="col-lg-8">
          <DownloadForm />
        </div>
        
        <!-- Download Queue -->
        <div class="col-lg-4">
          <DownloadQueue />
        </div>
      </div>
      
      <!-- Options Panel -->
      <div class="row mt-4">
        <div class="col-12">
          <OptionsPanel />
        </div>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useDownloadStore } from './stores/downloadStore'
import DownloadForm from './components/DownloadForm.vue'
import DownloadQueue from './components/DownloadQueue.vue'
import OptionsPanel from './components/OptionsPanel.vue'

const downloadStore = useDownloadStore()
const showRestorationNotice = ref(false)

const restoredJobsCount = computed(() => {
  return downloadStore.jobs.filter(job => 
    job.logs.some(log => log.includes('restored from previous session'))
  ).length
})

const dismissRestorationNotice = () => {
  showRestorationNotice.value = false
}

onMounted(() => {
  // Show restoration notice if there are restored jobs
  if (restoredJobsCount.value > 0) {
    showRestorationNotice.value = true
    // Auto-dismiss after 10 seconds
    setTimeout(() => {
      showRestorationNotice.value = false
    }, 10000)
  }
})
</script>
