<template>
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
  </main>
</template>

<script setup lang="ts">
import { useUsenetStore } from '../stores/usenetStore'
import DownloadForm from '../components/DownloadForm.vue'
import DownloadQueue from '../components/DownloadQueue.vue'
import UsenetQueue from '../components/UsenetQueue.vue'

const usenetStore = useUsenetStore()
</script>
