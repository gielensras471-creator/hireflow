<template>
  <el-config-provider :locale="zhCn">
    <main v-if="v3Build && !route.matched.length" class="v3-ui">
      <V3Feedback state="loading" title="正在确认身份" />
    </main>
    <RouterView v-else />
  </el-config-provider>
</template>

<script setup lang="ts">
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import { useRoute } from 'vue-router'
import V3Feedback from './components/V3Feedback.vue'

const route = useRoute()
const v3Build =
  (import.meta.env.DEV && import.meta.env.MODE === 'v3-local') ||
  import.meta.env.MODE === 'v3-production' ||
  import.meta.env.MODE === 'v3-demo'
</script>
