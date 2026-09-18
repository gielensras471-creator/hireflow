<template>
  <div class="not-found">
    <div class="not-found__code">404</div>
    <h1>页面不存在</h1>
    <p>当前地址可能已失效，返回 HireFlow 工作台继续操作。</p>
    <el-button type="primary" @click="router.push('/dashboard')">返回工作台</el-button>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()
</script>

<style scoped lang="scss">
.not-found {
  display: grid;
  min-height: 100vh;
  place-items: center;
  align-content: center;
  padding: 40px;
  color: var(--hf-text);
  text-align: center;
  background: var(--hf-bg);
}

.not-found__code {
  color: var(--hf-primary);
  font-size: clamp(72px, 12vw, 140px);
  font-weight: 800;
  line-height: 0.9;
  letter-spacing: -0.06em;
}

h1 {
  margin: 26px 0 8px;
  font-size: 24px;
}

p {
  margin: 0 0 24px;
  color: var(--hf-text-secondary);
}
</style>
