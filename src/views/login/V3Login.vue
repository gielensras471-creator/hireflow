<template>
  <main class="v3-ui v4-login">
    <section class="login-frame" aria-labelledby="login-title">
      <img class="login-hero" :src="hero" alt="" />
      <div class="login-panel" :class="{ 'login-panel-formal': !demo }">
        <div class="login-brand">
          <svg width="38" height="38" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
            <path fill="currentColor" d="M8 0h16l8 8v16l-8 8H8l-8-8V8z" />
            <path fill="none" stroke="#fff" stroke-width="2" d="M9 7v18m14-18v18M9 16h14" />
          </svg>
          HireFlow
        </div>
        <div class="login-content">
          <header>
            <h1 id="login-title">欢迎回来</h1>
            <p>登录 HireFlow 招聘工作台</p>
            <p v-if="v3AccountLoginNotice" class="login-account-notice" role="status">
              {{ v3AccountLoginNotice }}
            </p>
          </header>
          <V3Feedback
            v-if="recovering || (status === 'checking' && !pending)"
            state="loading"
            title="正在确认身份"
          />
          <template v-else-if="status === 'unavailable' && !pending">
            <V3Feedback
              state="error"
              title="暂时无法确认身份"
              message="可重试连接，或使用其他账号。"
              action="重试连接"
              @action="restore"
            />
            <el-button class="login-switch" @click="useOtherAccount">使用其他账号</el-button>
          </template>
          <form v-else novalidate :aria-busy="pending" @submit.prevent="submit">
            <div class="login-field">
              <label for="v3-username">账号</label>
              <el-input
                id="v3-username"
                ref="usernameInput"
                v-model="username"
                autocomplete="username"
                placeholder="请输入账号"
                :disabled="pending"
                required
                :aria-invalid="invalid === 'username' ? 'true' : undefined"
                :aria-describedby="invalid === 'username' ? 'login-error' : undefined"
              />
            </div>
            <div class="login-field">
              <label for="v3-password">密码</label>
              <el-input
                id="v3-password"
                ref="passwordInput"
                v-model="password"
                type="password"
                autocomplete="current-password"
                placeholder="请输入密码"
                :disabled="pending"
                required
                :aria-invalid="invalid === 'password' || errorStatus === 401 ? 'true' : undefined"
                :aria-describedby="
                  invalid === 'password' || errorStatus === 401 ? 'login-error' : undefined
                "
              />
            </div>
            <el-checkbox v-model="remember" :disabled="pending">记住登录状态</el-checkbox>
            <p v-if="feedback" id="login-error" class="login-error" role="alert">{{ feedback }}</p>
            <el-button
              class="login-submit"
              type="primary"
              native-type="submit"
              :disabled="pending"
              :loading="pending"
              >{{ pending ? '登录中…' : '登录工作台' }}</el-button
            >
            <span v-if="pending" class="login-sr" role="status">正在提交并确认身份</span>
          </form>
          <aside v-if="demo && status !== 'unavailable'" class="login-demo" aria-label="公开演示">
            <div class="login-demo-heading">
              <strong>公开演示</strong>
              <el-button
                native-type="button"
                :disabled="pending || status === 'checking' || recovering"
                @click="fillDemo"
                >一键填入演示账号</el-button
              >
            </div>
            <p class="login-demo-credentials">
              账号：<b>{{ demo.username }}</b
              ><span aria-hidden="true" />密码：<b>{{ demo.password }}</b>
            </p>
            <p class="login-demo-note">
              共享演示空间，仅限虚构资料。请勿输入真实个人信息或正式凭据。
            </p>
          </aside>
        </div>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { v3Session, adaptV3Error, v3AccountLoginNotice } from '../../api/request-v3'
import { safeReturn } from '../../router/v3-navigation'
import V3Feedback from '../../components/V3Feedback.vue'
import hero from '../../assets/hireflow-login-hero.png'
import '../../styles/v3.scss'

const demo =
  import.meta.env.MODE === 'v3-demo' ? { username: 'demo_admin', password: 'a123456' } : null
const route = useRoute()
const router = useRouter()
const username = ref('')
const password = ref('')
const remember = ref(false)
const usernameInput = ref<{ focus(): void }>()
const passwordInput = ref<{ focus(): void }>()
const pending = ref(false)
const recovering = ref(false)
const invalid = ref<'username' | 'password'>()
const errorStatus = ref<number>()
const message = ref('')
const status = computed(() => v3Session.state.status)
const feedback = computed(
  () =>
    message.value ||
    (status.value === 'forbidden'
      ? '当前账号没有招聘权限。'
      : v3Session.state.expired
        ? '登录已失效，请重新登录。'
        : '')
)

function clearFeedback() {
  message.value = ''
  errorStatus.value = undefined
  invalid.value = undefined
}

watch([username, password], () => {
  if (!pending.value) clearFeedback()
})

function fillDemo() {
  if (!demo || pending.value) return
  username.value = demo.username
  password.value = demo.password
  clearFeedback()
}

async function useOtherAccount() {
  v3Session.clear()
  clearFeedback()
  await nextTick()
  usernameInput.value?.focus()
}

async function restore() {
  if (recovering.value) return
  recovering.value = true
  try {
    await v3Session.refresh()
    if (status.value === 'ready') {
      v3AccountLoginNotice.value = ''
      await router.replace(safeReturn(route.query.redirect))
    }
  } finally {
    recovering.value = false
  }
}

async function submit() {
  if (pending.value) return
  clearFeedback()
  if (!username.value.trim() || !password.value) {
    invalid.value = !username.value.trim() ? 'username' : 'password'
    message.value = invalid.value === 'username' ? '请输入账号。' : '请输入密码。'
    if (invalid.value === 'username') usernameInput.value?.focus()
    else passwordInput.value?.focus()
    return
  }
  pending.value = true
  try {
    await v3Session.signIn({
      username: username.value,
      password: password.value,
      remember: remember.value
    })
    if (status.value === 'ready') {
      v3AccountLoginNotice.value = ''
      await router.replace(safeReturn(route.query.redirect))
    }
  } catch (error) {
    const problem = adaptV3Error(error)
    errorStatus.value = problem.status
    message.value =
      problem.status === 401
        ? '账号或密码不正确，请重新输入密码。'
        : problem.status === 0
          ? '网络连接暂时不可用。恢复连接后请重新输入密码，再登录。'
          : problem.message
  } finally {
    password.value = ''
    await nextTick()
    pending.value = false
    if (status.value !== 'ready') {
      await nextTick()
      passwordInput.value?.focus()
    }
  }
}
</script>

<style scoped lang="scss" src="./v4-login.scss"></style>
