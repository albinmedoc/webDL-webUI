<template>
  <div>
    <!-- Restoration Notice -->
    <div v-if="showRestorationNotice" class="alert alert-info alert-dismissible fade show m-0 rounded-0" role="alert">
      <div class="container-fluid">
        <i class="bi bi-info-circle me-2"></i>
        <strong>Downloads restored!</strong> {{ restoredJobsCount }} download(s) have been restored from your previous session.
        <button type="button" class="btn-close" aria-label="Close" @click="dismissRestorationNotice"></button>
      </div>
    </div>

    <main class="container-fluid py-4">
      <div class="row g-4">
        <div class="col-lg-8">
          <DownloadForm />
        </div>

        <div class="col-lg-4 d-flex flex-column gap-3">
          <DownloadQueue />
          <UsenetQueue v-if="usenetStore.enabled" />
        </div>
      </div>

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
import { useDownloadStore } from '../stores/downloadStore'
import { useUsenetStore } from '../stores/usenetStore'
import DownloadForm from '../components/DownloadForm.vue'
import DownloadQueue from '../components/DownloadQueue.vue'
import OptionsPanel from '../components/OptionsPanel.vue'
import UsenetQueue from '../components/UsenetQueue.vue'

const downloadStore = useDownloadStore()
const usenetStore = useUsenetStore()
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
  if (restoredJobsCount.value > 0) {
    showRestorationNotice.value = true
    setTimeout(() => {
      showRestorationNotice.value = false
    }, 10000)
  }
})
</script>
