<template>
  <section class="v3-offer" aria-label="Offer 与招聘结案">
    <p v-if="props.disabled" role="status">
      申请详情正在读取、读取失败或等待编辑结束，请先完成当前编辑或重新加载申请详情。
    </p>
    <header>
      <h2>Offer 与招聘结案</h2>
      <p>仅手工登记实际事实；接受 Offer 不等于已录用。</p>
    </header>
    <section v-if="loading" class="v3-card v3-offer-loading" aria-busy="true">
      <h3>Offer 状态与结束资格</h3>
      <span aria-hidden="true" /><span aria-hidden="true" />
      <p role="status">读取服务器状态中…</p>
    </section>
    <V3Feedback
      v-else-if="error"
      state="error"
      title="暂时无法查看 Offer 与结案资格"
      :message="error"
      :action="props.disabled ? undefined : '重试 Offer 状态'"
      @action="load"
    />
    <template v-else-if="state">
      <section class="v3-card">
        <h3>Offer 处理</h3>
        <V3OfferState :state="state.state" />
        <div v-for="action in offerKeys" :key="action" class="v3-offer-command">
          <el-button
            :type="action === 'send' || action === 'confirmHire' ? 'primary' : undefined"
            :disabled="blocked || !offerAllowed(state, action)"
            @click="open(action)"
            >{{ offerActions[action] }}</el-button
          ><small v-if="!offerAllowed(state, action)">{{
            offerBlocks[state.offer.actions[action].blockedReason ?? ''] ?? '当前状态不允许此动作。'
          }}</small>
        </div>
      </section>
      <section class="v3-card">
        <h3>结束招聘</h3>
        <p>普通结案仅限企业淘汰或候选人退出；不能用于录用或拒绝 Offer。</p>
        <el-button :disabled="blocked || !state.closure.allowed" @click="open('close')"
          >结束招聘</el-button
        >
        <p v-if="!state.closure.allowed">
          {{ offerBlocks[state.closure.blockedReason ?? ''] ?? '当前不能结束。' }}
        </p>
      </section>
      <section
        v-if="state.closure.pendingInterviews.length || state.offer.pendingInterviews.length"
        class="v3-card v3-offer-warning"
      >
        <h3>结束操作的待处理预约</h3>
        <p>请先完成或取消；登记发送和接受仍以各自动作资格为准。</p>
        <ul>
          <li v-for="row in state.closure.pendingInterviews" :key="row.interviewId">
            面试 #{{ row.interviewId }} · {{ label(row.stageScope) }} ·
            {{ feedbackTime(row.scheduledAt) }}
          </li>
        </ul>
        <template v-if="!state.closure.pendingInterviews.length">
          <p v-for="row in state.offer.pendingInterviews" :key="row.interviewId">
            面试 #{{ row.interviewId }} · {{ label(row.stageScope) }} ·
            {{ feedbackTime(row.scheduledAt) }}
          </p></template
        >
      </section>
    </template>
    <el-button
      :disabled="
        props.disabled || loading || !!gate.current.value || v3Session.state.status !== 'ready'
      "
      @click="load"
      >刷新 Offer 状态</el-button
    >
    <p v-if="operationError" role="alert" class="v3-error">{{ operationError }}</p>
    <V3OfferEditor
      v-if="editor"
      :original="editor.context"
      :action="editor.action"
      @close="close"
      @saved="saved"
    />
    <section class="v3-card" data-detail-history="offer">
      <h3>Offer 与结案真实历史</h3>
      <p v-if="!historyLoading && !historyError">
        {{ historyCaption(history) }} 旧版历史未核实；本来源记录不代表旧版历史完整。
      </p>
      <button
        v-if="history.length > 3 && !historyLoading && !historyError"
        type="button"
        class="v3-history-toggle"
        :aria-expanded="historyExpanded"
        @click="toggleHistory"
      >
        {{ historyExpanded ? '收起本组全部' : '查看本组全部' }}（{{ history.length }} 条）
      </button>
      <V3Feedback v-if="historyLoading" state="loading" title="读取 Offer 历史中" />
      <V3Feedback
        v-else-if="historyError"
        state="error"
        title="暂时无法查看 Offer 历史"
        :message="historyError"
        action="重试 Offer 历史"
        @action="loadHistory"
      />
      <p v-else-if="!history.length">
        暂无 Offer 或结案事件；当前已读取的该来源未记录可核实的业务事件，不根据当前状态补造历史。
      </p>
      <template v-else
        ><details
          v-for="(event, index) in orderHistory(history)"
          v-show="historyExpanded || index < 3"
          :key="event.eventId"
          :data-offer-event="event.eventId"
        >
          <summary>
            {{
              event.eventType
                ? Object.hasOwn(eventNames, event.eventType)
                  ? eventNames[event.eventType]
                  : '未知，待核实'
                : '未记录事件类型'
            }}
            · 事件 #{{ event.eventId }} · {{ feedbackTime(event.occurredAt) }} · 实际 HR：{{
              event.actorName || '未记录操作者'
            }}
            · 账号 #{{ event.actorUserId }} · {{ event.reason || '未记录附加原因' }}
          </summary>
          <p>
            实际 HR：{{ event.actorName }} · 账号 #{{ event.actorUserId }} ·
            {{ feedbackTime(event.occurredAt) }}
          </p>
          <p v-if="event.reason">实际原因：{{ event.reason }}</p>
          <p v-if="event.reasonSource">
            原因来源：{{
              event.reasonSource === 'system_default'
                ? '服务器默认原因'
                : event.reasonSource === 'hr_input'
                  ? 'HR 手工输入'
                  : '未知，待核实'
            }}
          </p>
          <div class="v3-offer-compare">
            <section>
              <h4>操作前</h4>
              <V3OfferState :state="event.before" />
            </section>
            <section>
              <h4>操作后</h4>
              <V3OfferState :state="event.after" />
            </section>
          </div></details
      ></template>
      <el-button
        :disabled="historyLoading || v3Session.state.status !== 'ready'"
        @click="loadHistory"
        >刷新 Offer 历史</el-button
      >
    </section>
  </section>
</template>
<script setup lang="ts">
import { orderHistory, historyCaption } from '../api/history-display'
import { readOfferContext } from '../api/offer-read'
import { computed, inject, nextTick, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { readV3, v3Session } from '../api/request-v3'
import { latestRead } from '../api/v3-operation'
import { label } from '../api/recruiting-v3'
import { feedbackTime } from '../api/feedback-v3'
import {
  offerAllowed,
  offerActions,
  offerBlocks,
  eventNames,
  type OfferContext,
  type OfferAction,
  type OfferEvent
} from '../api/offer-v3'
import { createEditorGate, editorGateKey } from '../utils/v3-editor-gate'
import V3Feedback from './V3Feedback.vue'
import V3OfferState from './V3OfferState.vue'
import V3OfferEditor from './V3OfferEditor.vue'
import '../styles/v3-offer.scss'
const props = defineProps<{ applicationId: number; disabled?: boolean; refreshToken?: number }>(),
  emit = defineEmits<{ updated: [] }>()
const route = useRoute(),
  gate = inject(editorGateKey, null) ?? createEditorGate()
const state = ref<OfferContext | null>(null),
  editor = ref<{ context: OfferContext; action: OfferAction } | null>(null),
  loading = ref(false),
  opening = ref(false),
  error = ref(''),
  operationError = ref('')
const history = ref<OfferEvent[]>([]),
  historyLoading = ref(false),
  historyError = ref('')
const reads = latestRead(),
  historyReads = latestRead()
const offerKeys = ['send', 'accept', 'decline', 'confirmHire'] as const
const blocked = computed(
  () =>
    props.disabled ||
    loading.value ||
    !!error.value ||
    opening.value ||
    !!gate.current.value ||
    v3Session.state.status !== 'ready'
)
let alive = true,
  attempt = 0,
  lease: symbol | null = null
function load() {
  if (props.disabled || gate.current.value || v3Session.state.status !== 'ready') return
  loading.value = true
  error.value = ''
  state.value = null
  return reads.execute(
    () => readOfferContext(props.applicationId),
    (c) => {
      state.value = c
      loading.value = false
    },
    (e) => {
      error.value = e instanceof Error ? e.message : '读取失败'
      loading.value = false
    }
  )
}
function loadHistory() {
  historyLoading.value = true
  historyError.value = ''
  history.value = []
  return historyReads.execute(
    () => readV3<OfferEvent[]>('/applications/' + props.applicationId + '/offer/history'),
    (v) => {
      history.value = v
      historyLoading.value = false
    },
    (e) => {
      historyError.value = e instanceof Error ? e.message : '读取失败'
      historyLoading.value = false
    }
  )
}
async function open(action: OfferAction) {
  if (blocked.value) return
  const acquired = gate.acquire()
  if (!acquired) return
  lease = acquired
  opening.value = true
  operationError.value = ''
  const path = route.fullPath,
    owner = v3Session.version(),
    id = ++attempt
  try {
    const c = await readOfferContext(props.applicationId)
    if (
      !alive ||
      id !== attempt ||
      path !== route.fullPath ||
      owner !== v3Session.version() ||
      v3Session.state.status !== 'ready' ||
      !gate.owns(acquired)
    )
      return
    state.value = c
    if (!offerAllowed(c, action)) throw new Error('服务器当前资格不允许该操作，请查看最新状态。')
    editor.value = { context: c, action }
  } catch (e) {
    if (alive && id === attempt && owner === v3Session.version())
      operationError.value = e instanceof Error ? e.message : '打开失败'
  } finally {
    if (id === attempt) opening.value = false
    if (!editor.value) {
      gate.release(acquired)
      if (lease === acquired) lease = null
    }
  }
}
async function close() {
  const releasing = lease
  attempt++
  opening.value = false
  editor.value = null
  await nextTick()
  if (releasing) gate.release(releasing)
  if (lease === releasing) lease = null
}
async function saved() {
  await close()
  emit('updated')
}
watch(
  () => [props.applicationId, route.fullPath],
  () => {
    reads.invalidate()
    historyReads.invalidate()
    void close()
    void load()
    void loadHistory()
  },
  { immediate: true }
)
watch(
  () => props.refreshToken,
  () => {
    if (!props.disabled && !gate.current.value) {
      void load()
      void loadHistory()
    }
  }
)
onUnmounted(() => {
  alive = false
  attempt++
  reads.invalidate()
  historyReads.invalidate()
  if (lease) gate.release(lease)
})

const historyExpanded = ref(false)
async function toggleHistory(event: Event) {
  const control = event.currentTarget as HTMLButtonElement
  historyExpanded.value = !historyExpanded.value
  if (!historyExpanded.value) {
    await nextTick()
    control.focus({ preventScroll: true })
  }
}
watch(
  () => history.value,
  () => {
    historyExpanded.value = false
  }
)
</script>
