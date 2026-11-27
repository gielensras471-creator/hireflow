<template>
  <section v-if="route.name === 'v3-profile'" class="v4-profile" aria-labelledby="profile-title">
    <header>
      <h1 id="profile-title">个人中心</h1>
      <p>管理个人资料与账号安全</p>
    </header>
    <V3Feedback v-if="status === 'checking'" state="loading" title="正在确认身份" />
    <div v-else-if="user" class="profile-layout">
      <section class="v3-card profile-account">
        <h2>个人档案</h2>
        <div class="profile-summary">
          <span class="profile-avatar" aria-hidden="true">{{ initial }}</span>
          <div>
            <h2>{{ name }}</h2>
            <p>{{ account }}</p>
            <span class="profile-role">{{ role }}</span>
          </div>
        </div>
        <dl>
          <div>
            <dt>账号</dt>
            <dd>{{ account }}</dd>
          </div>
          <div>
            <dt>显示名称</dt>
            <dd>{{ name }}</dd>
          </div>
          <div>
            <dt>角色</dt>
            <dd>{{ role }}</dd>
          </div>
        </dl>
        <el-button
          class="profile-edit"
          :disabled="demo || status !== 'ready'"
          aria-describedby="profile-availability"
          @click="openEditor('name', $event)"
          >编辑个人资料</el-button
        >
      </section>

      <div class="profile-stack">
        <section class="v3-card profile-security">
          <h2>账号安全</h2>
          <div class="profile-verification">
            <span class="profile-lock" aria-hidden="true">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
              >
                <path d="M12 2 4 5v6c0 5 3.3 8.2 8 11 4.7-2.8 8-6 8-11V5z" />
                <path d="m8.5 12 2.5 2.5 4.5-5" />
              </svg>
            </span>
            <div>
              <strong>{{
                status === 'ready' ? '当前会话已通过身份验证' : '暂时无法确认当前身份'
              }}</strong>
              <p>请妥善保管账号及登录凭据。</p>
            </div>
          </div>
          <div class="profile-row">
            <div>
              <strong>登录密码</strong>
              <p>修改密码，保护账号安全。</p>
            </div>
            <el-button
              :disabled="demo || status !== 'ready'"
              aria-describedby="profile-availability"
              @click="openEditor('password', $event)"
              >修改密码</el-button
            >
          </div>
          <div class="profile-row">
            <div>
              <strong>当前登录会话</strong>
              <p>退出当前设备上的登录状态。</p>
            </div>
            <el-button
              v-if="logout"
              class="profile-exit"
              :disabled="status !== 'ready'"
              @click="logout"
              >退出登录</el-button
            >
          </div>
          <p v-if="!demo" id="profile-availability" class="profile-availability">
            仅可修改本人显示名称与密码。改密后须重新登录。
          </p>
        </section>
        <section class="v3-card profile-preferences">
          <h2>工作偏好</h2>
          <p>默认视图保存在当前浏览器。</p>
          <div class="profile-row">
            <strong>默认候选人视图</strong>
            <div class="profile-segments" role="group" aria-label="默认候选人视图">
              <button
                v-for="view in candidateViews"
                :key="view"
                type="button"
                :disabled="status !== 'ready'"
                :aria-pressed="preferences.candidates === view"
                @click="savePreference('candidates', view)"
              >
                {{ view === 'board' ? '看板' : '表格' }}
              </button>
            </div>
          </div>
          <div class="profile-row">
            <strong>默认面试视图</strong>
            <div class="profile-segments" role="group" aria-label="默认面试视图">
              <button
                v-for="view in interviewViews"
                :key="view"
                type="button"
                :disabled="status !== 'ready'"
                :aria-pressed="preferences.interviews === view"
                @click="savePreference('interviews', view)"
              >
                {{ interviewLabels[view] }}
              </button>
            </div>
          </div>
          <p v-if="preferenceMessage" role="status">{{ preferenceMessage }}</p>
        </section>
        <aside v-if="demo" id="profile-availability" class="profile-notice">
          <strong>公开演示模式</strong>
          <p>共享演示账号禁止修改显示名称和密码。</p>
        </aside>
      </div>

      <el-dialog
        v-if="!demo"
        v-model="editorOpen"
        class="profile-preview"
        width="min(480px, calc(100vw - 32px))"
        :title="editor === 'name' ? '修改显示名称' : '修改密码'"
        :before-close="closeEditor"
        :close-on-click-modal="false"
        destroy-on-close
        @opened="focusEditor"
        @closed="finishEditor"
      >
        <p class="profile-preview-note">
          {{
            editor === 'name'
              ? '账号及角色不可编辑。'
              : '需验证当前密码。新密码至少 12 个字符、最多 72 个 UTF-8 字节；保存后所有设备需重新登录。'
          }}
        </p>
        <form id="profile-account-form" :aria-busy="saving" @submit.prevent="saveAccount">
          <template v-if="editor === 'name'">
            <label for="profile-preview-name">显示名称</label>
            <el-input
              id="profile-preview-name"
              v-model="displayName"
              maxlength="128"
              :disabled="saving"
              :aria-describedby="issue ? 'profile-edit-error' : undefined"
            />
          </template>
          <template v-else>
            <template v-for="field in passwordFields" :key="field.id">
              <label :for="field.id">{{ field.label }}</label>
              <el-input
                :id="field.id"
                v-model="secrets[field.key]"
                type="password"
                :autocomplete="field.key === 'current' ? 'current-password' : 'new-password'"
                :placeholder="field.hint"
                :disabled="saving"
                :aria-describedby="issue ? 'profile-edit-error' : undefined"
              />
            </template>
          </template>
          <p v-if="issue" id="profile-edit-error" class="profile-error" role="alert">{{ issue }}</p>
        </form>
        <template #footer>
          <el-button
            :disabled="saving"
            @click="
              closeEditor(() => {
                editorOpen = false
              })
            "
            >取消</el-button
          >
          <el-button
            class="profile-save"
            type="primary"
            native-type="submit"
            form="profile-account-form"
            :disabled="saving || status !== 'ready'"
            :loading="saving"
            >保存</el-button
          >
        </template>
      </el-dialog>
    </div>
    <p v-if="notice" class="profile-notice" role="status">{{ notice }}</p>
  </section>
  <section v-else>
    <h1>{{ title }}</h1>
    <V3Feedback
      state="empty"
      title="V3 功能接入中"
      message="当前仅开放本地会话、导航与标签页验证。招聘操作将在后续批次接入。"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute } from 'vue-router'
import {
  adaptV3Error,
  updateOwnDisplayName,
  updateOwnPassword,
  v3AccountLoginNotice,
  v3Session
} from '../api/request-v3'
import { confirmV3Leave, v3DraftDirty } from '../router/v3-drafts'
import {
  candidateViews,
  interviewViews,
  preferenceDefaults,
  workPreferences,
  type WorkPreferences
} from '../utils/v4-work-preferences'
import { tabInfo } from '../router/v3-navigation'
import V3Feedback from '../components/V3Feedback.vue'

const route = useRoute()
const demo = import.meta.env.MODE === 'v3-demo'
const editor = ref<'name' | 'password'>('name')
const editorOpen = ref(false)
const saving = ref(false)
const issue = ref('')
const notice = ref('')
const displayName = ref('')
const originalName = ref('')
let opener: HTMLElement | null = null
const secrets = reactive({ current: '', password: '', confirmation: '' })
const passwordFields = [
  { key: 'current', id: 'profile-current-password', label: '当前密码', hint: '请输入当前密码' },
  { key: 'password', id: 'profile-new-password', label: '新密码', hint: '请输入新密码' },
  {
    key: 'confirmation',
    id: 'profile-confirm-password',
    label: '确认新密码',
    hint: '请再次输入新密码'
  }
] as const
const logout = inject<() => void>('v3-shell-logout')
const user = computed(() => v3Session.state.user)
const status = computed(() => v3Session.state.status)
const preferences = ref<WorkPreferences>({ ...preferenceDefaults })
const preferenceMessage = ref('')
const interviewLabels = { day: '日', week: '周', month: '月' }
watch(
  () => user.value?.id,
  (id) => {
    preferences.value = id ? workPreferences.read(id) : { ...preferenceDefaults }
    preferenceMessage.value = ''
  },
  { immediate: true }
)
function savePreference<K extends keyof WorkPreferences>(key: K, value: WorkPreferences[K]) {
  if (!user.value || status.value !== 'ready') return
  preferences.value = { ...preferences.value, [key]: value }
  preferenceMessage.value = workPreferences.save(user.value.id, preferences.value)
    ? '已保存到当前浏览器。'
    : '当前会话已应用，浏览器未能保存偏好。'
}
const title = computed(() => tabInfo(route.path)?.title)
const account = computed(() => user.value?.username?.trim() || '未提供')
const name = computed(() => user.value?.name?.trim() || '未提供')
const role = computed(() => {
  const value = user.value?.role?.trim()
  if (value === 'hr') return '招聘管理员'
  if (value === 'admin') return '管理员'
  return value || '未提供'
})
const initial = computed(() =>
  Array.from(user.value?.name?.trim() || user.value?.username?.trim() || '账')[0].toUpperCase()
)
const dirty = computed(
  () =>
    editorOpen.value &&
    (editor.value === 'name'
      ? displayName.value !== originalName.value
      : Boolean(secrets.current || secrets.password || secrets.confirmation))
)
watch(
  dirty,
  (value) => {
    v3DraftDirty.value = value
  },
  { flush: 'sync' }
)
watch(status, (value) => {
  if (value === 'anonymous' || value === 'forbidden') {
    editorOpen.value = false
    clearEditor()
  }
})
onBeforeRouteLeave(() => !saving.value || status.value !== 'ready')
onBeforeUnmount(() => {
  if (dirty.value) v3DraftDirty.value = false
  clearEditor()
})

function clearEditor() {
  secrets.current = secrets.password = secrets.confirmation = ''
  displayName.value = originalName.value = ''
  issue.value = ''
}
function openEditor(kind: 'name' | 'password', event: MouseEvent) {
  if (demo || status.value !== 'ready' || !confirmV3Leave()) return
  clearEditor()
  notice.value = ''
  editor.value = kind
  opener = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
  displayName.value = originalName.value = user.value?.name ?? ''
  editorOpen.value = true
}
async function finishEditor() {
  clearEditor()
  const target = opener
  opener = null
  await nextTick()
  if (status.value === 'ready' && !editorOpen.value && target?.isConnected) target.focus()
}
function focusEditor() {
  document
    .getElementById(editor.value === 'name' ? 'profile-preview-name' : passwordFields[0].id)
    ?.focus()
}
function closeEditor(done: () => void) {
  if (!saving.value && confirmV3Leave()) done()
}
function requireLogin(message: string) {
  v3AccountLoginNotice.value = message
  editorOpen.value = false
  clearEditor()
  v3Session.clear()
}
async function saveAccount() {
  if (saving.value || demo || !editorOpen.value || status.value !== 'ready') return
  const changingPassword = editor.value === 'password'
  issue.value = ''
  if (!changingPassword && !displayName.value.trim()) {
    issue.value = '请输入显示名称。'
    focusEditor()
    return
  }
  if (
    changingPassword &&
    (!secrets.current || !secrets.password || secrets.password !== secrets.confirmation)
  ) {
    issue.value = '请填写当前密码、新密码，并确认两次新密码一致。'
    document.getElementById(!secrets.current ? passwordFields[0].id : passwordFields[2].id)?.focus()
    return
  }
  const version = v3Session.version()
  saving.value = true
  try {
    if (changingPassword) {
      await updateOwnPassword(secrets.current, secrets.password)
      requireLogin('密码已修改，请使用新密码重新登录。')
    } else {
      await updateOwnDisplayName(displayName.value)
      editorOpen.value = false
      await v3Session.refreshAfterWrite()
      if (v3Session.version() === version) notice.value = '显示名称已保存。'
    }
  } catch (error) {
    const problem = adaptV3Error(error)
    if (v3Session.version() !== version) return
    if (changingPassword && (problem.status === 0 || problem.status >= 500)) {
      requireLogin('改密结果尚未确认。请重新登录核对，避免重复提交。')
      return
    }
    if (problem.code === 'ACCOUNT_CHANGED') await v3Session.refresh()
    if (v3Session.version() !== version) return
    issue.value = problem.message
    if (problem.code === 'CURRENT_PASSWORD_INVALID') {
      secrets.current = ''
      await nextTick()
    }
  } finally {
    saving.value = false
    if (issue.value && editorOpen.value) {
      await nextTick()
      focusEditor()
    }
  }
}
</script>

<style scoped lang="scss" src="./v4-profile.scss"></style>
