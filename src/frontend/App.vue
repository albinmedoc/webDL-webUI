<template>
  <div class="min-vh-100 bg-light">
    <nav class="navbar navbar-expand-lg navbar-dark bg-primary shadow-sm">
      <div class="container-fluid">
        <RouterLink to="/" class="navbar-brand fw-bold fs-3">
          <i class="bi bi-download me-2"></i>
          SVTPlay-dl Web Interface
        </RouterLink>
        <ul class="navbar-nav me-auto">
          <li class="nav-item">
            <RouterLink to="/" class="nav-link" active-class="active" :class="{ active: $route.name === 'downloads' }">
              <i class="bi bi-cloud-download me-1"></i>
              Downloads
            </RouterLink>
          </li>
          <li v-if="usenetStore.enabled" class="nav-item">
            <RouterLink to="/usenet" class="nav-link" active-class="active">
              <i class="bi bi-cloud-upload me-1"></i>
              Usenet History
            </RouterLink>
          </li>
        </ul>
        <div class="navbar-nav ms-auto d-flex align-items-center gap-3">
          <span class="navbar-text">
            <i class="bi bi-activity me-1"></i>
            Active downloads: <span class="badge bg-light text-primary">{{ downloadStore.activeJobs.length }}</span>
          </span>
          <button
            v-if="usenetStore.enabled"
            class="btn btn-sm btn-outline-light"
            @click="settingsOpen = true"
            title="Usenet settings"
          >
            <i class="bi bi-gear"></i>
          </button>
        </div>
      </div>
    </nav>

    <RouterView />

    <SettingsModal v-if="settingsOpen" @close="settingsOpen = false" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink, RouterView } from 'vue-router'
import { useDownloadStore } from './stores/downloadStore'
import { useUsenetStore } from './stores/usenetStore'
import SettingsModal from './components/SettingsModal.vue'

const downloadStore = useDownloadStore()
const usenetStore = useUsenetStore()
const settingsOpen = ref(false)
</script>

<style scoped>
.nav-link.active {
  font-weight: 600;
  background-color: rgba(255, 255, 255, 0.15);
  border-radius: 0.25rem;
}
</style>
