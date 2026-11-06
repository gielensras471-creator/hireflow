<template>
  <main class="v3-ui v3-login">
    <section class="v3-card v3-login-card">
      <p class="v3-brand">HireFlow</p>
      <h1>登录招聘工作台</h1>
      <p>V3 · 本地隔离联调</p>
      <V3Feedback v-if="status === 'checking' && !pending" state="loading" title="正在确认身份" />
      <V3Feedback
        v-else-if="status === 'unavailable' && !pending"
        state="error"
        title="暂时无法确认身份"
        message="可重试连接，或使用其他账号。"
        action="重试连接"
        @action="restore"
      />
      <form v-else @submit.prevent="submit">
        <label for="v3-username">账号</label>
        <el-input id="v3-username" v-model="username" autocomplete="username" required />
        <label for="v3-password">密码</label>
        <el-input
          id="v3-password"
          v-model="password"
          type="password"
          autocomplete="current-password"
          required
        />
        <el-checkbox v-model="remember">记住登录状态</el-checkbox>
        <p v-if="status === 'forbidden'" class="v3-error" role="alert">当前账号没有招聘权限。</p>
        <p v-else-if="message" class="v3-error" role="alert">{{ message }}</p>
        <p v-else-if="v3Session.state.expired" class="v3-error" role="alert">
          登录已失效，请重新登录。
        </p>
        <el-button type="primary" native-type="submit" :loading="pending">登录</el-button>
      </form>
      <el-button v-if="status === 'unavailable'" @click="v3Session.clear()">使用其他账号</el-button>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { v3Session, adaptV3Error } from '../../api/request-v3'
import { safeReturn } from '../../router/v3-navigation'
import V3Feedback from '../../components/V3Feedback.vue'
import '../../styles/v3.scss'

const route = useRoute()
const router = useRouter()
const username = ref('')
const password = ref('')
const remember = ref(false)
const pending = ref(false)
const message = ref('')
const status = computed(() => v3Session.state.status)

async function restore() {
  await v3Session.refresh()
  if (status.value === 'ready') await router.replace(safeReturn(route.query.redirect))
}

async function submit() {
  if (pending.value) return
  pending.value = true
  message.value = ''
  try {
    await v3Session.signIn({
      username: username.value,
      password: password.value,
      remember: remember.value
    })
    if (status.value === 'ready') await router.replace(safeReturn(route.query.redirect))
  } catch (error) {
    message.value = adaptV3Error(error).message
  } finally {
    password.value = ''
    pending.value = false
  }
}
</script>
