<template>
  <div class="v3-filter-field v3-filter-select">
    <label :for="id">{{ label }}</label>
    <el-select
      :id="id"
      :aria-label="label"
      :model-value="modelValue"
      :empty-values="[null, undefined]"
      fit-input-width
      popper-class="v3-filter-popper"
      @update:model-value="$emit('update:modelValue', $event)"
    >
      <el-option v-if="allLabel" value="" :label="allLabel" />
      <el-option v-for="(text, value) in options" :key="value" :value="value" :label="text" />
    </el-select>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  id: string
  label: string
  modelValue: string
  options: Record<string, string>
  allLabel?: string
}>()

defineEmits<{ 'update:modelValue': [value: string] }>()
</script>
