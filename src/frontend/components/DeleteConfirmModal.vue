<template>
  <Teleport to="body">
    <div class="modal-backdrop-custom" @click.self="$emit('cancel')">
      <div class="modal-dialog-custom card shadow-lg">
        <div class="card-header bg-danger text-white d-flex justify-content-between align-items-center">
          <div class="fw-semibold">
            <i class="bi bi-exclamation-triangle me-2"></i>
            {{ title }}
          </div>
          <button
            type="button"
            class="btn-close btn-close-white"
            aria-label="Close"
            @click="$emit('cancel')"
          ></button>
        </div>

        <div class="card-body">
          <p class="mb-3" style="white-space: pre-line;">{{ message }}</p>

          <div class="form-check">
            <input
              id="delete-files-checkbox"
              v-model="deleteFiles"
              type="checkbox"
              class="form-check-input"
            />
            <label class="form-check-label" for="delete-files-checkbox">
              {{ checkboxLabel }}
            </label>
          </div>
          <div v-if="checkboxHint" class="form-text small text-muted">
            {{ checkboxHint }}
          </div>
        </div>

        <div class="card-footer d-flex justify-content-end gap-2">
          <button class="btn btn-sm btn-outline-secondary" @click="$emit('cancel')">
            Cancel
          </button>
          <button class="btn btn-sm btn-danger" @click="$emit('confirm', { deleteFiles })">
            <i class="bi bi-trash me-1"></i>
            {{ confirmLabel }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const props = withDefaults(
  defineProps<{
    title: string
    message: string
    checkboxLabel?: string
    checkboxHint?: string
    confirmLabel?: string
    defaultDeleteFiles?: boolean
  }>(),
  {
    checkboxLabel: 'Also delete files on disk',
    checkboxHint: '',
    confirmLabel: 'Delete',
    defaultDeleteFiles: true,
  },
)

defineEmits<{
  confirm: [{ deleteFiles: boolean }]
  cancel: []
}>()

const deleteFiles = ref(props.defaultDeleteFiles)
</script>

<style scoped>
.modal-backdrop-custom {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 1060;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}
.modal-dialog-custom {
  width: min(480px, 100%);
}
</style>
