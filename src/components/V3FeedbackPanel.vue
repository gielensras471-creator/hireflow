<template>
  <section class="v3-feedback-panel" aria-label="面试评价管理">
    <p v-if="props.disabled" role="status">
      申请详情正在读取、读取失败或等待编辑结束，请先完成当前编辑或重新加载申请详情。
    </p>
    <header>
      <h2>面试评价</h2>
      <p>评价独立于面试状态和 HR 决策；历史缺评与当前轮次分别展示。</p>
      <el-button :disabled="props.disabled || loading || !!gate.current.value" @click="load"
        >刷新面评</el-button
      >
    </header>
    <V3FeedbackEditor
      v-if="editor"
      :key="editor.key"
      :application="editor.application"
      :interview-id="editor.interviewId"
      :original="editor.original"
      :action="editor.action"
      @close="closeEditor"
      @saved="saved"
    />
    <p v-if="operationError" class="v3-error" role="alert">{{ operationError }}</p>
    <section v-if="loading" class="v3-card v3-feedback-loading" aria-busy="true">
      <h3>面试与关联评价</h3>
      <article v-for="row in 3" :key="row" aria-hidden="true"><span /><span /><span /></article>
      <p role="status">加载面评及补录资格中，请稍候…</p>
    </section>
    <V3Feedback
      v-else-if="error"
      state="error"
      title="暂时无法查看面评"
      :message="error"
      :action="props.disabled ? undefined : '重新加载'"
      @action="load"
    />
    <V3Feedback
      v-else-if="!context?.interviews.length"
      state="empty"
      title="暂无可关联的面试评价"
      message="实际面试完成后可录入评价，不预填默认结论。"
    />
    <template v-else>
      <article
        v-for="meeting in displayedMeetings"
        :key="meeting.id"
        class="v3-card v3-feedback-card"
        :data-feedback-interview="meeting.id"
        :data-existing-feedback="record(meeting.id)?.id"
      >
        <header class="v3-feedback-heading">
          <h3>面试 #{{ meeting.id }} · {{ label(meeting.stageScope) }}</h3>
          <span class="v3-feedback-badge">{{ interviewStatus[meeting.status] }}</span>
          <span class="v3-feedback-badge">{{
            meeting.stageScope === context.application.stage ? '当前轮次' : '历史轮次'
          }}</span>
          <span v-if="record(meeting.id)?.corrected" class="v3-feedback-badge">已更正</span>
        </header>
        <template v-if="record(meeting.id)">
          <V3FeedbackSnapshot :value="record(meeting.id)!" />
          <p v-if="facts(meeting.id)?.supplementEventId" class="v3-feedback-notice">
            晋级后补录 · {{ feedbackTime(facts(meeting.id)!.supplementedAt!) }} · 补录事件 #{{
              facts(meeting.id)!.supplementEventId
            }}
          </p>
          <div class="v3-feedback-actions">
            <el-button :disabled="blocked" @click="showHistory(record(meeting.id)!)"
              >查看面评历史</el-button
            >
            <el-button
              :disabled="blocked || meeting.status !== 'completed'"
              @click="open(meeting.id, 'correct')"
              >更正面评</el-button
            >
          </div>
        </template>
        <template v-else>
          <p>
            {{ facts(meeting.id)?.historicalMissing ? '历史缺评（已说明原因推进）' : '尚无面评' }}
          </p>
          <p v-if="!allowed('submit', meeting) && !allowed('supplement', meeting)">
            {{
              blockedMessages[facts(meeting.id)?.blockedReason ?? ''] ?? '当前状态不允许提交评价。'
            }}
          </p>
          <div class="v3-feedback-actions">
            <el-button
              v-if="allowed('submit', meeting)"
              type="primary"
              :disabled="blocked"
              @click="open(meeting.id, 'submit')"
              >填写面评</el-button
            >
            <el-button
              v-if="allowed('supplement', meeting)"
              type="primary"
              :disabled="blocked"
              @click="open(meeting.id, 'supplement')"
              >补录历史面评</el-button
            >
          </div>
        </template>
        <details v-if="facts(meeting.id)?.waivers.length" class="v3-feedback-waivers" open>
          <summary>已说明原因推进 · 原晋级豁免事实</summary>
          <p v-for="waiver in facts(meeting.id)!.waivers" :key="waiver.eventId">
            事件 #{{ waiver.eventId }} · {{ feedbackTime(waiver.occurredAt) }} ·
            {{ label(waiver.stageScope) }} → {{ label(waiver.toStage) }} · 原因：{{ waiver.reason }}
          </p>
        </details>
      </article>
    </template>
    <section v-if="historyId" class="v3-card">
      <h3>评价 #{{ historyId }} 的真实记录</h3>
      <V3Feedback v-if="historyLoading" state="loading" title="加载面评历史中" />
      <V3Feedback
        v-else-if="historyError"
        state="error"
        title="暂时无法查看历史"
        :message="historyError"
        action="重试历史"
        @action="loadHistory"
      />
      <V3FeedbackHistory
        v-else-if="history"
        :items="history.items"
        :decisions="history.decisions"
      />
      <el-button @click="hideHistory">收起历史</el-button>
    </section>
  </section>
</template>
<script setup lang="ts">
import { computed, inject, nextTick, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  readFeedbackContext,
  readFeedbackHistory,
  type FeedbackContext
} from '../api/feedback-read'
import {
  blockedMessages,
  feedbackAllowed,
  feedbackTime,
  type FeedbackRecord,
  type FeedbackAction
} from '../api/feedback-v3'
import { label, type Application } from '../api/recruiting-v3'
import { interviewStatus, type Interview } from '../api/interview-v3'
import { latestRead } from '../api/v3-operation'
import { v3Session } from '../api/request-v3'
import { createEditorGate, editorGateKey } from '../utils/v3-editor-gate'
import V3Feedback from './V3Feedback.vue'
import V3FeedbackEditor from './V3FeedbackEditor.vue'
import V3FeedbackSnapshot from './V3FeedbackSnapshot.vue'
import V3FeedbackHistory from './V3FeedbackHistory.vue'
import '../styles/v3-feedback.scss'
const props = defineProps<{ applicationId: number; disabled?: boolean; refreshToken?: number }>()
const emit = defineEmits<{ updated: [] }>()
const route = useRoute()
const gate = inject(editorGateKey, null) ?? createEditorGate()
let lease: symbol | null = null,
  alive = true,
  generation = 0,
  key = 0
const context = ref<FeedbackContext | null>(null),
  loading = ref(false),
  error = ref(''),
  operationError = ref(''),
  opening = ref(false)
const editor = ref<{
  application: Application
  interviewId: number
  original: FeedbackRecord | null
  action: FeedbackAction
  key: number
} | null>(null)
const reads = latestRead(),
  historyReads = latestRead()
const historyId = ref<number | null>(null),
  historyLoading = ref(false),
  historyError = ref('')
const history = ref<Awaited<ReturnType<typeof readFeedbackHistory>> | null>(null)
const blocked = computed(
  () =>
    props.disabled ||
    loading.value ||
    !!error.value ||
    !context.value ||
    opening.value ||
    !!gate.current.value ||
    v3Session.state.status !== 'ready'
)
const displayedMeetings = computed(() => {
  const rows = context.value?.interviews ?? []
  const stage = context.value?.application.stage
  return [
    ...rows.filter((row) => row.stageScope === stage),
    ...rows.filter((row) => row.stageScope !== stage)
  ]
})
const record = (id: number) => context.value?.feedback.find((row) => row.interviewId === id) ?? null
const facts = (id: number) => context.value?.eligibility.find((row) => row.interviewId === id)
function allowed(action: FeedbackAction, meeting: Interview) {
  const eligibility = facts(meeting.id)
  return (
    !!context.value &&
    !!eligibility &&
    feedbackAllowed(action, context.value.application, meeting, record(meeting.id), eligibility)
  )
}
function load() {
  if (props.disabled || gate.current.value || v3Session.state.status !== 'ready') return
  loading.value = true
  error.value = ''
  context.value = null
  historyReads.invalidate()
  historyId.value = null
  return reads.execute(
    () => readFeedbackContext(props.applicationId),
    (value) => {
      context.value = value
      loading.value = false
    },
    (e) => {
      error.value = e instanceof Error ? e.message : '读取失败'
      loading.value = false
    }
  )
}
async function open(id: number, action: FeedbackAction) {
  if (blocked.value) return
  const acquired = gate.acquire()
  if (!acquired) return
  lease = acquired
  const path = route.fullPath,
    owner = v3Session.version(),
    attempt = ++generation
  opening.value = true
  operationError.value = ''
  try {
    const value = await readFeedbackContext(props.applicationId)
    const meeting = value.interviews.find((row) => row.id === id)
    const eligibility = value.eligibility.find((row) => row.interviewId === id)
    const original = value.feedback.find((row) => row.interviewId === id) ?? null
    if (
      !alive ||
      path !== route.fullPath ||
      owner !== v3Session.version() ||
      v3Session.state.status !== 'ready' ||
      attempt !== generation ||
      lease !== acquired ||
      !gate.owns(acquired)
    )
      return
    if (
      !meeting ||
      !eligibility ||
      !feedbackAllowed(action, value.application, meeting, original, eligibility)
    )
      throw new Error('服务器当前状态不允许该面评操作，请刷新后查看。')
    context.value = value
    editor.value = { application: value.application, interviewId: id, original, action, key: ++key }
  } catch (e) {
    if (alive && owner === v3Session.version() && path === route.fullPath && attempt === generation)
      operationError.value = e instanceof Error ? e.message : '无法打开面评'
  } finally {
    if (attempt === generation) opening.value = false
    if (!editor.value) {
      gate.release(acquired)
      if (lease === acquired) lease = null
    }
  }
}
async function closeEditor() {
  const releasing = lease
  generation++
  opening.value = false
  editor.value = null
  await nextTick()
  if (releasing) gate.release(releasing)
  if (lease === releasing) lease = null
}
async function saved() {
  await closeEditor()
  emit('updated')
  void load()
}
function hideHistory() {
  historyId.value = null
  historyReads.invalidate()
}
function showHistory(row: FeedbackRecord) {
  historyId.value = row.id
  void loadHistory()
}
function loadHistory() {
  if (!historyId.value || v3Session.state.status !== 'ready') return
  historyLoading.value = true
  historyError.value = ''
  history.value = null
  return historyReads.execute(
    () => readFeedbackHistory(props.applicationId, historyId.value!),
    (value) => {
      history.value = value
      historyLoading.value = false
    },
    (e) => {
      historyError.value = e instanceof Error ? e.message : '读取失败'
      historyLoading.value = false
    }
  )
}
watch(
  () => [props.applicationId, route.fullPath],
  () => {
    reads.invalidate()
    historyReads.invalidate()
    void closeEditor()
    void load()
  },
  { immediate: true }
)
watch(
  () => props.refreshToken,
  () => {
    if (!props.disabled && !gate.current.value) {
      void load()
    }
  }
)
onUnmounted(() => {
  alive = false
  generation++
  reads.invalidate()
  historyReads.invalidate()
  if (lease) gate.release(lease)
})
</script>
