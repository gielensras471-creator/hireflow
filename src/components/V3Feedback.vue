<template>
  <section class="v3-card v3-feedback" :aria-busy="state === 'loading'">
    <h2 :role="state === 'error' ? 'alert' : 'status'">{{ title }}</h2>
    <div v-if="state === 'loading'" class="v3-skeleton" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
    <p v-if="message">{{ message }}</p>
    <el-button v-if="state !== 'loading' && action" type="primary" @click="$emit('action')">
      {{ action }}
    </el-button>
  </section>
</template>

<script setup lang="ts">
defineProps<{
  state: 'loading' | 'empty' | 'error'
  title: string
  message?: string
  action?: string
}>()
defineEmits<{ action: [] }>()
</script>
