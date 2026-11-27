<template>
  <section class="v3-card v4-application-history" aria-labelledby="v4-history-title">
    <h2 id="v4-history-title">真实历史</h2>
    <p>按已记录的事件发生时间（北京时间）展示。旧版及未记录历史仍待核实。</p>
    <nav class="v3-detail-history-links" aria-label="专用历史来源">
      <button type="button" @click="$emit('source', 'advancement-history')">查看晋级历史</button>
      <button type="button" @click="$emit('source', 'offer-history')">查看 Offer 与结案历史</button>
      <button type="button" @click="$emit('source', 'feedback')">查看面评及专用历史</button>
    </nav>
    <p v-if="error" class="v3-error" role="alert">
      通用事件来源读取失败：{{ error }}。可继续核实各专用来源。
    </p>
    <p v-else-if="loaded && !items.length" role="status">此来源暂无可核实的业务事件。</p>
    <ol v-if="items.length" class="v4-event-timeline" aria-label="申请业务事件">
      <li
        v-for="event in orderHistory(items)"
        :key="event.eventId"
        :data-timeline-event="event.eventId"
      >
        <div class="v4-event-time">
          <strong>{{ safeHistoryTime(event.occurredAt, feedbackTime) }}</strong>
          <small>事件 #{{ event.eventId }}</small>
        </div>
        <details
          class="v4-event-facts"
          :open="event.eventType === 'feedback_corrected' || undefined"
        >
          <summary>
            <span class="v4-detail-symbol" aria-hidden="true">{{
              event.eventType === 'stage_advanced' ? '→' : '·'
            }}</span>
            <strong>{{ names[event.eventType] ?? '待核实的事件类型' }}</strong>
            <span v-if="event.interviewId">面试 #{{ event.interviewId }}</span>
            <span v-if="event.feedbackId">面评 #{{ event.feedbackId }}</span>
          </summary>
          <p>
            实际操作者：{{ event.actorName || '未记录'
            }}<span v-if="event.actorUserId"> · 账号 #{{ event.actorUserId }}</span> · 回执 #{{
              event.commandId
            }}
          </p>
          <p v-if="event.reason">原因：{{ event.reason }}</p>
          <p v-if="event.changedFields?.length">
            变更字段：{{
              event.changedFields.map((field) => profileLabels[field] ?? field).join('、')
            }}
          </p>
          <p v-if="event.waiverEventId">关联豁免事件 #{{ event.waiverEventId }}</p>
          <p
            v-if="event.priorDecisions?.advancementEventId || event.priorDecisions?.closureEventId"
          >
            原决策事件
            {{
              [event.priorDecisions.advancementEventId, event.priorDecisions.closureEventId]
                .filter(Boolean)
                .map((id) => '#' + id)
                .join('、')
            }}
          </p>
          <p v-for="row in event.missingFeedbackLinks" :key="row.interviewId">
            晋级当时缺评：面试 #{{ row.interviewId }} · {{ label(row.stageScope) }}
            <span v-if="row.supplementEventId"> · 后续补录事件 #{{ row.supplementEventId }}</span>
          </p>
          <div class="v4-event-snapshots">
            <section v-for="snapshot in snapshots(event)" :key="snapshot.title">
              <h3>{{ snapshot.title }}</h3>
              <dl>
                <div v-for="[key, value] in snapshot.fields" :key="key">
                  <dt>{{ fieldNames[key] }}</dt>
                  <dd>{{ format(key, value) }}</dd>
                </div>
              </dl>
            </section>
          </div>
        </details>
      </li>
    </ol>
    <p v-if="loading" role="status">正在读取真实事件…</p>
    <el-button v-else-if="error || cursor" :disabled="!ready" @click="load">{{
      error ? '重试通用事件' : '加载更早或后续已记录事件'
    }}</el-button>
    <p v-if="loaded && cursor && !error">已载入 {{ items.length }} 条，仍有后续分页。</p>
  </section>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { readV3, v3Session } from '../api/request-v3'
import { latestRead } from '../api/v3-operation'
import { orderHistory, safeHistoryTime } from '../api/history-display'
import { appendEvents, type HistoryCursor } from '../api/v4-application-detail'
import { applicationFields, label } from '../api/recruiting-v3'
import { feedbackTime, recommendations, type Recommendation } from '../api/feedback-v3'
import { eventNames } from '../api/offer-v3'
import { interviewStatus } from '../api/interview-v3'

type Snapshot = Record<string, string | number | null>
type Event = HistoryCursor & {
  eventType: string
  actorName: string
  actorUserId: number
  commandId: string
  reason: string | null
  interviewId: number | null
  feedbackId: number | null
  before: Snapshot | null
  after: Snapshot | null
  changedFields?: string[]
  waiverEventId?: number
  priorDecisions?: { advancementEventId: number | null; closureEventId: number | null }
  missingFeedbackLinks?: {
    interviewId: number
    stageScope: string
    supplementEventId: number | null
  }[]
}
const props = defineProps<{ applicationId: number; active: boolean; revision: number }>()
defineEmits<{ source: [target: string] }>()
const ready = computed(() => v3Session.state.status === 'ready')
const reads = latestRead()
const items = ref<Event[]>([])
const cursor = ref<HistoryCursor | null>(null)
const loaded = ref(false)
const loading = ref(false)
const error = ref('')
const names: Record<string, string> = {
  ...eventNames,
  candidate_created: '创建申请',
  candidate_updated: '更新申请资料',
  stage_advanced: 'HR 确认推进',
  interview_scheduled: '安排面试',
  interview_rescheduled: '改期',
  interview_completed: '完成面试',
  interview_cancelled: '取消面试',
  feedback_submitted: '提交面评',
  feedback_supplemented: '晋级后补录',
  feedback_corrected: '面评有痕更正'
}
const profileLabels = Object.fromEntries(applicationFields)
const fieldNames: Record<string, string> = {
  stage: '阶段',
  applicationStatus: '申请生命周期',
  offerStatus: 'Offer 子状态',
  outcome: '招聘结果',
  closedReason: '结案原因',
  closedAt: '结案时间',
  version: '版本',
  stageScope: '轮次',
  status: '场次状态',
  scheduledAt: '预约时间',
  completedAt: '完成时间',
  cancelledAt: '取消时间',
  reviewerName: '专业评价人',
  recordedByUserId: '实际录入账号',
  recommendation: '推荐结论',
  reason: '业务依据',
  submittedAt: '提交时间',
  revision: '修订版本'
}
function format(key: string, value: string | number | null) {
  if (value === null) return '—'
  if (key.endsWith('At')) return safeHistoryTime(value, feedbackTime)
  if (key === 'recommendation') return recommendations[value as Recommendation] ?? '待核实'
  if (key === 'status') return interviewStatus[value as keyof typeof interviewStatus] ?? '待核实'
  if (['stage', 'stageScope', 'applicationStatus', 'offerStatus', 'outcome'].includes(key))
    return label(String(value))
  return String(value)
}
function snapshots(event: Event) {
  return [
    { title: '变更前', snapshot: event.before },
    { title: event.before ? '变更后' : '已记录内容', snapshot: event.after }
  ].flatMap(({ title, snapshot }) =>
    snapshot
      ? [
          {
            title,
            fields: Object.entries(snapshot).filter(([key]) =>
              Object.prototype.hasOwnProperty.call(fieldNames, key)
            )
          }
        ]
      : []
  )
}

function load() {
  if (!ready.value || loading.value || (loaded.value && !cursor.value)) return
  loading.value = true
  error.value = ''
  const params = new URLSearchParams({ limit: '20' })
  if (cursor.value) {
    params.set('afterOccurredAt', String(cursor.value.occurredAt))
    params.set('afterEventId', String(cursor.value.eventId))
  }
  void reads.execute(
    () =>
      readV3<{ items: Event[]; nextCursor: HistoryCursor | null }>(
        '/applications/' + props.applicationId + '/history?' + params
      ),
    (page) => {
      items.value = appendEvents(items.value, page.items)
      cursor.value = page.nextCursor
      loaded.value = true
      loading.value = false
    },
    (failure) => {
      error.value = failure instanceof Error ? failure.message : '读取失败'
      loading.value = false
    }
  )
}
watch(
  () => [props.applicationId, props.revision, ready.value],
  () => {
    reads.invalidate()
    items.value = []
    cursor.value = null
    loaded.value = loading.value = false
    error.value = ''
    if (props.active) load()
  },
  { immediate: true }
)
watch(
  () => props.active,
  (active) => {
    if (active && !loaded.value && !error.value) load()
  }
)
onUnmounted(() => reads.invalidate())
</script>
