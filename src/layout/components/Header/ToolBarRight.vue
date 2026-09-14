<template>
  <div class="tool-bar-rt">
    <FullScreen />

    <span class="toolbar-divider"></span>

    <Avatar />
  </div>
</template>

<script setup lang="ts">
import FullScreen from './components/Fullscreen.vue'
import Avatar from './components/Avatar.vue'
</script>

<style scoped lang="scss">
.tool-bar-rt {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;

  .toolbar-divider {
    width: 1px;
    height: 22px;
    margin: 0 2px;
    background: var(--el-border-color-lighter);
  }

  :deep(.fullscreen) {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    color: var(--el-text-color-regular);
    border-radius: 9px;
    transition:
      background 0.2s ease,
      color 0.2s ease;

    &:hover {
      color: var(--el-color-primary);
      background: var(--el-fill-color-light);
    }
  }
}
</style>
