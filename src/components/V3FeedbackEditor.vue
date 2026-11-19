<template>
  <section class="v3-card v3-feedback-editor">
    <h2>{{ feedbackActions[action] }} · 面试 #{{ interviewId }}</h2>
    <p>
      {{ application.name }} · {{ application.positionTitle }} · {{ label(application.stage) }} ·
      {{ label(application.applicationStatus) }}
    </p>
    <p>提交不会推进招聘阶段。更正保留首次提交时间、最初录入账号及原招聘决策。</p>
    <div :class="{ 'v3-feedback-compare': action === 'correct' }">
      <section v-if="original">
        <h3>当前有效内容 · 只读</h3>
        <V3FeedbackSnapshot :value="original" />
      </section>
      <form @submit.prevent="submit">
        <h3>{{ action === 'correct' ? '更新当前有效面评' : '面试评价' }}</h3>
        <fieldset :disabled="busy || uncertain || conflict || v3Session.state.status !== 'ready'">
          <label
            >专业评价人姓名 *<input v-model="reviewer" required aria-label="专业评价人姓名"
          /></label>
          <fieldset>
            <legend>推荐意见 *</legend>
            <div class="v3-feedback-choices">
              <label v-for="(text, value) in recommendations" :key="value">
                <input
                  v-model="recommendation"
                  type="radio"
                  name="feedback-recommendation"
                  :value="value"
                  required
                  :aria-label="text"
                />{{ text }}
              </label>
            </div>
          </fieldset>
          <label>推荐依据 *<textarea v-model="reason" required aria-label="推荐依据" /></label>
          <label v-if="action === 'correct'"
            >更正原因 *<textarea v-model="correctionReason" required aria-label="更正原因" />
          </label>
        </fieldset>
        <p class="v3-feedback-notice">
          实际录入账号：{{ v3Session.state.user?.name }} · 账号 #{{
            v3Session.state.user?.id
          }}（服务器核验）
        </p>
        <p v-if="error" class="v3-error" role="alert">{{ error }}</p>
        <p v-if="uncertain" role="status">
          本次操作结果尚未确认，服务器可能已经保存。请先核实结果；如需重试，请使用原请求，不要另建操作。
        </p>
        <section v-if="conflict" class="v3-feedback-conflict">
          <p class="v3-conflict-summary" role="status">
            这条记录已有新的业务进展。草稿已保留，请先查看最新状态，再决定是否继续操作。
          </p>
          <h3>草稿已保留，请核对服务器最新事实</h3>
          <p v-if="latest">
            当前申请 {{ label(latest.application.stage) }} ·
            {{ label(latest.application.applicationStatus) }} · 申请版本
            {{ latest.application.version }}
          </p>
          <V3FeedbackSnapshot v-if="latestFeedback" :value="latestFeedback" />
          <p v-if="latest && !retryAllowed">服务器当前状态不允许该操作，请返回查看。</p>
          <el-button
            type="primary"
            :disabled="busy || v3Session.state.status !== 'ready'"
            @click="refreshConflict"
            >重新读取服务器状态</el-button
          >
          <el-button
            :disabled="busy || !retryAllowed || v3Session.state.status !== 'ready'"
            @click="confirmRetry"
            >确认按新版本重新提交</el-button
          >
        </section>
        <div class="v3-feedback-actions">
          <el-button :disabled="busy" @click="cancel">返回</el-button>
          <el-button
            v-if="!conflict"
            type="primary"
            native-type="submit"
            :loading="busy"
            :disabled="v3Session.state.status !== 'ready'"
            >{{
              uncertain ? '重试原请求' : action === 'correct' ? '保存有痕更正' : '提交评价'
            }}</el-button
          >
        </div>
      </form>
    </div>
    <V3FeedbackHistory
      v-if="conflict && history"
      :items="history.items"
      :decisions="history.decisions"
    />
  </section>
</template>
<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import {
  readFeedbackContext,
  readFeedbackHistory,
  type FeedbackContext
} from '../api/feedback-read'
import {
  feedbackAllowed,
  feedbackActions,
  recommendations,
  type FeedbackAction,
  type FeedbackRecord,
  type Recommendation
} from '../api/feedback-v3'
import { label, type Application } from '../api/recruiting-v3'
import { v3Session, writeV3 } from '../api/request-v3'
import { createWriteIntent } from '../api/v3-operation'
import { V3Error } from '../utils/auth-v3'
import { confirmV3Leave, v3DraftDirty, v3UncertainWrite } from '../router/v3-drafts'
import V3FeedbackSnapshot from './V3FeedbackSnapshot.vue'
import V3FeedbackHistory from './V3FeedbackHistory.vue'
const props = defineProps<{
  application: Application
  interviewId: number
  original: FeedbackRecord | null
  action: FeedbackAction
}>()
const emit = defineEmits<{ close: []; saved: [] }>()
const reviewer = ref(props.original?.reviewerName ?? ''),
  recommendation = ref<Recommendation | ''>(props.original?.recommendation ?? ''),
  reason = ref(props.original?.reason ?? ''),
  correctionReason = ref('')
const initial = JSON.stringify([reviewer.value, recommendation.value, reason.value, ''])
const busy = ref(false),
  uncertain = ref(false),
  conflict = ref(false),
  error = ref('')
const version = ref(props.application.version),
  revision = ref(props.original?.revision)
const latest = ref<FeedbackContext | null>(null),
  history = ref<Awaited<ReturnType<typeof readFeedbackHistory>> | null>(null)
const latestFeedback = computed(
  () => latest.value?.feedback.find((row) => row.interviewId === props.interviewId) ?? null
)
const retryAllowed = computed(() => {
  if (!latest.value) return false
  const meeting = latest.value.interviews.find((row) => row.id === props.interviewId)
  const facts = latest.value.eligibility.find((row) => row.interviewId === props.interviewId)
  return (
    !!meeting &&
    !!facts &&
    feedbackAllowed(props.action, latest.value.application, meeting, latestFeedback.value, facts)
  )
})
const owner = v3Session.version()
let alive = true
const current = () => alive && owner === v3Session.version()
let frozen: { path: string; body: Record<string, unknown>; version: number } | null = null
const intent = createWriteIntent<unknown>(() => crypto.randomUUID())
watch([reviewer, recommendation, reason, correctionReason, uncertain], () => {
  v3UncertainWrite.value = uncertain.value
  v3DraftDirty.value =
    uncertain.value ||
    JSON.stringify([reviewer.value, recommendation.value, reason.value, correctionReason.value]) !==
      initial
})
function clearDraft() {
  v3DraftDirty.value = false
  v3UncertainWrite.value = false
}
function cancel() {
  if (confirmV3Leave()) {
    clearDraft()
    emit('close')
  }
}
async function refreshConflict() {
  busy.value = true
  latest.value = null
  history.value = null
  try {
    const facts = await readFeedbackContext(props.application.id)
    const record = facts.feedback.find((row) => row.interviewId === props.interviewId)
    const events = record ? await readFeedbackHistory(props.application.id, record.id) : null
    if (!current()) return
    latest.value = facts
    history.value = events
  } catch (e) {
    if (current()) error.value = e instanceof Error ? e.message : '读取失败'
  } finally {
    if (current()) busy.value = false
  }
}
function confirmRetry() {
  if (
    !current() ||
    v3Session.state.status !== 'ready' ||
    busy.value ||
    !retryAllowed.value ||
    !latest.value ||
    !window.confirm('确认保留草稿，并按刚读取的申请版本和面评修订版本提交新的操作？')
  )
    return
  version.value = latest.value.application.version
  revision.value = latestFeedback.value?.revision
  frozen = null
  conflict.value = false
  void submit()
}
async function submit() {
  if (busy.value || conflict.value || !current() || v3Session.state.status !== 'ready') return
  error.value = ''
  if (!frozen) {
    if (
      !reviewer.value.trim() ||
      !reason.value.trim() ||
      !Object.hasOwn(recommendations, recommendation.value)
    ) {
      error.value = '请填写专业评价人、推荐意见和非空依据。'
      return
    }
    if (props.action === 'correct' && !correctionReason.value.trim()) {
      error.value = '更正必须填写原因。'
      return
    }
    frozen = {
      path:
        '/applications/' +
        props.application.id +
        '/interviews/' +
        props.interviewId +
        '/feedback' +
        (props.action === 'submit' ? '' : '/' + props.action),
      body: {
        reviewerName: reviewer.value.trim(),
        recommendation: recommendation.value,
        reason: reason.value.trim(),
        ...(props.action === 'correct'
          ? { feedbackRevision: revision.value, correctionReason: correctionReason.value.trim() }
          : {})
      },
      version: version.value
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
    if (!current()) return
    clearDraft()
    emit('saved')
  } catch (e) {
    if (!current()) return
    error.value = e instanceof Error ? e.message : '提交失败'
    if (e instanceof V3Error && e.status === 409 && e.code !== 'NO_CHANGE') {
      conflict.value = true
      await refreshConflict()
    }
    if (!intent.uncertain) frozen = null
  } finally {
    if (current()) {
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
