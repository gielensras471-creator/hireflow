<template>
  <section class="v3-advancement" aria-label="招聘阶段与 HR 决策">
    <p v-if="props.disabled" role="status">
      申请详情正在读取、读取失败或等待编辑结束，请先完成当前编辑或重新加载申请详情。
    </p>
    <header>
      <h2>招聘阶段与 HR 决策</h2>
      <p>阶段由 HR 明确决定，面试完成或面评推荐不会自动晋级。</p>
    </header>
    <ol class="v3-stage-strip" aria-label="四阶段位置（不是事件历史）">
      <li
        v-for="stage in stages"
        :key="stage"
        :aria-current="state?.preflight.fromStage === stage ? 'step' : undefined"
      >
        {{ label(stage) }}
      </li>
    </ol>
    <section v-if="loading" class="v3-card v3-advance-loading" aria-busy="true">
      <h3>服务器晋级资格</h3>
      <span aria-hidden="true" /><span aria-hidden="true" />
      <p role="status">读取资格中…</p>
    </section>
    <V3Feedback
      v-else-if="error"
      state="error"
      title="暂时无法核验晋级资格"
      :message="error"
      :action="props.disabled ? undefined : '重试晋级资格'"
      @action="load"
    />
    <section v-else-if="state" class="v3-card">
      <p>
        申请生命周期：{{ label(state.application.applicationStatus) }} · Offer 状态：{{
          label(state.application.offerStatus)
        }}
      </p>
      <V3AdvancementFacts :facts="state.preflight" :feedback="state.feedback" />
      <div class="v3-advance-actions">
        <el-button
          :disabled="props.disabled || !!gate.current.value || v3Session.state.status !== 'ready'"
          @click="load"
          >刷新晋级资格</el-button
        ><el-button type="primary" :disabled="blocked || !canAdvance(state.preflight)" @click="open"
          >核验并决定晋级</el-button
        >
      </div>
    </section>
    <p v-if="operationError" class="v3-error" role="alert">{{ operationError }}</p>
    <V3AdvancementEditor
      v-if="editor"
      :original="editor.preflight"
      :feedback="editor.feedback"
      @close="close"
      @saved="saved"
    />
    <section class="v3-card" data-detail-history="advancement">
      <h3>真实晋级历史</h3>
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
      <V3Feedback v-if="historyLoading" state="loading" title="读取晋级历史中" />
      <V3Feedback
        v-else-if="historyError"
        state="error"
        title="暂时无法查看晋级历史"
        :message="historyError"
        action="重试晋级历史"
        @action="loadHistory"
      />
      <p v-else-if="!history.length">
        暂无真实晋级事件；当前已读取的该来源未记录可核实的业务事件，当前阶段不能代替历史证据。
      </p>
      <details
        v-for="(event, index) in orderHistory(history)"
        v-else
        v-show="historyExpanded || index < 3"
        :key="event.eventId"
        :data-advancement-event="event.eventId"
      >
        <summary>
          {{ label(event.fromStage) }} → {{ label(event.toStage) }} ·
          {{
            event.kind
              ? Object.hasOwn(kinds, event.kind)
                ? kinds[event.kind]
                : '未知，待核实'
              : '未记录晋级类型'
          }}
          · 事件 #{{ event.eventId }} · {{ feedbackTime(event.occurredAt) }} · 实际 HR：{{
            event.actorName || '未记录操作者'
          }}
          · 账号 #{{ event.actorUserId }} · {{ event.reason || '未记录附加原因' }}
        </summary>
        <p>
          {{
            event.eventType === 'stage_advanced'
              ? '阶段晋级'
              : event.eventType
                ? '未知，待核实'
                : '未记录事件类型'
          }}
          · 实际 HR：{{ event.actorName }} · 账号 #{{ event.actorUserId }} ·
          {{ feedbackTime(event.occurredAt) }}
        </p>
        <p>晋级理由：{{ event.reason || '正常晋级，无附加理由' }}</p>
        <p v-if="event.missingInterviews.length">
          当时的缺评事实（后续补录不会改写）：<span
            v-for="row in event.missingInterviews"
            :key="row.interviewId"
            >面试 #{{ row.interviewId }} · {{ label(row.stageScope) }}；</span
          >
        </p>
      </details>
      <el-button
        :disabled="historyLoading || v3Session.state.status !== 'ready'"
        @click="loadHistory"
        >刷新晋级历史</el-button
      >
    </section>
  </section>
</template>
<script setup lang="ts">
import { orderHistory, historyCaption } from '../api/history-display'
import { computed, inject, nextTick, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { readV3, v3Session } from '../api/request-v3'
import { latestRead } from '../api/v3-operation'
import { label, type Application } from '../api/recruiting-v3'
import {
  stages,
  kinds,
  canAdvance,
  type Preflight,
  type AdvancementEvent
} from '../api/advancement-v3'
import { feedbackTime, type FeedbackRecord } from '../api/feedback-v3'
import { editorGateKey, createEditorGate } from '../utils/v3-editor-gate'
import V3Feedback from './V3Feedback.vue'
import V3AdvancementFacts from './V3AdvancementFacts.vue'
import V3AdvancementEditor from './V3AdvancementEditor.vue'
import '../styles/v3-advancement.scss'
const props = defineProps<{ applicationId: number; disabled?: boolean; refreshToken?: number }>()
const emit = defineEmits<{ updated: [] }>()
const route = useRoute(),
  gate = inject(editorGateKey, null) ?? createEditorGate()
type State = { application: Application; preflight: Preflight; feedback: FeedbackRecord[] }
const state = ref<State | null>(null),
  editor = ref<State | null>(null),
  loading = ref(false),
  error = ref(''),
  opening = ref(false),
  operationError = ref('')
const history = ref<AdvancementEvent[]>([]),
  historyLoading = ref(false),
  historyError = ref('')
const reads = latestRead(),
  historyReads = latestRead()
let alive = true,
  attempt = 0,
  lease: symbol | null = null
const blocked = computed(
  () =>
    props.disabled ||
    loading.value ||
    !!error.value ||
    opening.value ||
    !!gate.current.value ||
    v3Session.state.status !== 'ready'
)
async function readState() {
  const base = '/applications/' + props.applicationId
  const [application, preflight, feedback] = await Promise.all([
    readV3<Application>(base),
    readV3<Preflight>(base + '/advance/preflight'),
    readV3<FeedbackRecord[]>(base + '/feedback')
  ])
  return { application, preflight, feedback }
}
function load() {
  if (props.disabled || gate.current.value || v3Session.state.status !== 'ready') return
  loading.value = true
  error.value = ''
  state.value = null
  return reads.execute(
    readState,
    (value) => {
      state.value = value
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
    () =>
      readV3<AdvancementEvent[]>('/applications/' + props.applicationId + '/advancement/history'),
    (value) => {
      history.value = value
      historyLoading.value = false
    },
    (e) => {
      historyError.value = e instanceof Error ? e.message : '历史读取失败'
      historyLoading.value = false
    }
  )
}
async function open() {
  if (blocked.value) return
  const acquired = gate.acquire()
  if (!acquired) return
  lease = acquired
  opening.value = true
  operationError.value = ''
  const token = v3Session.version(),
    path = route.fullPath,
    id = ++attempt
  try {
    const value = await readState()
    if (
      !alive ||
      id !== attempt ||
      path !== route.fullPath ||
      token !== v3Session.version() ||
      v3Session.state.status !== 'ready' ||
      !gate.owns(acquired)
    )
      return
    state.value = value
    if (!canAdvance(value.preflight)) throw new Error('服务器当前状态不允许晋级，请查看最新资格。')
    editor.value = value
  } catch (e) {
    if (alive && id === attempt && token === v3Session.version())
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
