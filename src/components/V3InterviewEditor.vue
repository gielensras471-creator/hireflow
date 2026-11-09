<template>
  <section class="v3-card v3-interview-editor">
    <h2>{{ interviewAction[action] }} · 申请 #{{ application.id }}</h2>
    <p v-if="action === 'complete'">
      请确认这场面试实际已经完成。完成面试不会提交评价或推进招聘阶段。
    </p>
    <p v-if="action === 'schedule'">轮次由服务器根据申请当前阶段确定，同一申请不能并行预约。</p>
    <form @submit.prevent="submit">
      <fieldset :disabled="busy || uncertain || conflict || v3Session.state.status !== 'ready'">
        <label v-if="action === 'schedule' || action === 'reschedule'"
          >预约开始时间（上海，UTC+08:00）
          <input v-model="time" type="datetime-local" step="1" required aria-label="预约开始时间" />
        </label>
        <label v-if="action === 'schedule'"
          >专业面试官姓名<input v-model="interviewer" required aria-label="专业面试官姓名"
        /></label>
        <label v-if="action === 'schedule'"
          >备注<textarea v-model="note" aria-label="面试备注" />
        </label>
        <label v-if="action === 'cancel'"
          >取消原因<textarea v-model="reason" required aria-label="取消原因" />
        </label>
      </fieldset>
      <p v-if="error" class="v3-error" role="alert">{{ error }}</p>
      <p v-if="uncertain" role="status">提交结果尚未确定，请使用原请求确认结果。</p>
      <div v-if="conflict">
        <p>草稿已保留，请核对服务器当前状态后决定是否重新提交。</p>
        <p v-if="latestApplication">
          当前申请阶段 {{ label(latestApplication.stage) }} ·
          {{ label(latestApplication.applicationStatus) }} · 申请版本
          {{ latestApplication.version }}
        </p>
        <p v-if="latestInterview">
          面试状态 {{ interviewStatus[latestInterview.status] }} · 面试版本
          {{ latestInterview.interviewVersion }} · {{ latestInterview.scheduledLocal }}
        </p>
        <p v-if="latestApplication && !retryAllowed">
          当前状态已不允许该操作，请保留原事实并返回查看。
        </p>
        <el-button :disabled="busy" @click="refreshConflict">重新读取服务器状态</el-button>
        <el-button :disabled="!retryAllowed || busy" @click="confirmRetry"
          >确认按新版本重新提交</el-button
        >
      </div>
      <div class="v3-interview-actions">
        <el-button :disabled="busy || uncertain" @click="cancelEditor">返回</el-button>
        <el-button
          v-if="!conflict"
          type="primary"
          native-type="submit"
          :loading="busy"
          :disabled="v3Session.state.status !== 'ready'"
          >{{ uncertain ? '重试原请求' : interviewAction[action] }}</el-button
        >
      </div>
    </form>
  </section>
</template>
<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { v3Session, readV3, writeV3 } from '../api/request-v3'
import { V3Error } from '../utils/auth-v3'
import { createWriteIntent } from '../api/v3-operation'
import { label, type Application } from '../api/recruiting-v3'
import {
  canSchedule,
  shanghaiInput,
  interviewAction,
  interviewStatus,
  type Interview,
  type InterviewAction
} from '../api/interview-v3'
import { confirmV3Leave, v3DraftDirty, v3UncertainWrite } from '../router/v3-drafts'
const props = defineProps<{
  application: Application
  interview: Interview | null
  action: InterviewAction
}>()
const emit = defineEmits<{ close: []; saved: [] }>()
const time = ref(props.interview?.scheduledLocal.slice(0, 19) ?? ''),
  interviewer = ref(''),
  note = ref(''),
  reason = ref('')
const initial = JSON.stringify([time.value, '', '', ''])
const busy = ref(false),
  uncertain = ref(false),
  conflict = ref(false),
  error = ref('')
const applicationVersion = ref(props.application.version),
  meetingVersion = ref(props.interview?.interviewVersion)
const latestApplication = ref<Application | null>(null),
  latestInterview = ref<Interview | null>(null),
  latestRows = ref<Interview[]>([])
const retryAllowed = computed(
  () =>
    latestApplication.value &&
    (props.action === 'schedule'
      ? canSchedule(latestApplication.value, latestRows.value)
      : latestApplication.value.applicationStatus === 'active' &&
        latestInterview.value?.status === 'scheduled')
)
const owner = v3Session.version()
let alive = true
let frozen: { path: string; body: Record<string, unknown>; version: number } | null = null
const intent = createWriteIntent<unknown>(() => crypto.randomUUID())
watch([time, interviewer, note, reason, uncertain], () => {
  v3UncertainWrite.value = uncertain.value
  v3DraftDirty.value =
    JSON.stringify([time.value, interviewer.value, note.value, reason.value]) !== initial ||
    uncertain.value
})
function clearDraft() {
  v3DraftDirty.value = false
  v3UncertainWrite.value = false
}
function cancelEditor() {
  if (confirmV3Leave()) {
    clearDraft()
    emit('close')
  }
}
async function refreshConflict() {
  busy.value = true
  latestApplication.value = null
  latestInterview.value = null
  try {
    const [application, rows] = await Promise.all([
      readV3<Application>('/applications/' + props.application.id),
      readV3<Interview[]>('/applications/' + props.application.id + '/interviews')
    ])
    if (!alive || owner !== v3Session.version()) return
    latestRows.value = rows
    latestInterview.value = rows.find((row) => row.id === props.interview?.id) ?? null
    latestApplication.value = application
  } catch (e) {
    if (alive) error.value = e instanceof Error ? e.message : '读取失败'
  } finally {
    busy.value = false
  }
}
function confirmRetry() {
  if (
    !retryAllowed.value ||
    !latestApplication.value ||
    !window.confirm('确认保留草稿，并按刚读取的申请和面试版本发起新操作？')
  )
    return
  applicationVersion.value = latestApplication.value.version
  meetingVersion.value = latestInterview.value?.interviewVersion
  frozen = null
  conflict.value = false
  void submit()
}
async function submit() {
  if (busy.value || conflict.value) return
  if (!alive || owner !== v3Session.version()) return
  error.value = ''
  if (!frozen) {
    try {
      const body: Record<string, unknown> = {}
      if (props.action === 'schedule' || props.action === 'reschedule')
        body.scheduledAt = shanghaiInput(time.value)
      if (props.action === 'schedule') {
        if (!interviewer.value.trim()) throw new Error('请填写专业面试官姓名。')
        body.interviewerName = interviewer.value.trim()
        body.note = note.value
      } else body.interviewVersion = meetingVersion.value
      if (props.action === 'cancel') {
        if (!reason.value.trim()) throw new Error('请填写取消原因。')
        body.reason = reason.value.trim()
      }
      frozen = {
        path:
          '/applications/' +
          props.application.id +
          '/interviews' +
          (props.action === 'schedule' ? '' : '/' + props.interview!.id + '/' + props.action),
        body,
        version: applicationVersion.value
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : '请检查输入'
      return
    }
  }
  busy.value = true
  const request = frozen
  try {
    await intent.execute(
      request,
      (key) =>
        writeV3('POST', request.path, request.body, {
          operation: 'update',
          expectedVersion: request.version,
          idempotencyKey: key
        }),
      (e) => (e instanceof V3Error ? e.status : 0)
    )
    if (!alive || owner !== v3Session.version()) return
    clearDraft()
    emit('saved')
  } catch (e) {
    if (!alive || owner !== v3Session.version()) return
    error.value = e instanceof Error ? e.message : '操作失败'
    if (e instanceof V3Error && e.status === 409 && e.code !== 'NO_CHANGE') {
      conflict.value = true
      await refreshConflict()
    }
    if (!intent.uncertain) frozen = null
  } finally {
    if (alive) {
      busy.value = false
      uncertain.value = intent.uncertain
    }
  }
}
onUnmounted(() => {
  alive = false
  clearDraft()
})
</script>
