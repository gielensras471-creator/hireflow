<template>
  <section
    class="v3-interviews"
    :class="{
      'v4-interviews': !applicationId,
      'v4-interviews-split': !applicationId && panelOpen,
      'v4-calendar-page': calendar
    }"
  >
    <header :class="{ 'v4-embedded-interview-header': !!applicationId }">
      <div v-if="!applicationId" class="v4-interviews-title">
        <h1>面试管理</h1>
        <p>查看日程预约，集中处理面试记录。</p>
      </div>
      <h2 v-else>面试记录</h2>
      <p v-if="applicationId || !calendar">预约时间均为北京时间。到时仅提示，完成需要 HR 确认。</p>
      <el-button
        :disabled="props.disabled || loading || weekState === 'reading' || !!editor || opening"
        @click="load"
        >刷新面试记录</el-button
      >
      <div v-if="!applicationId" class="v4-interview-switch" aria-label="面试视图">
        <button type="button" :aria-pressed="calendar" @click="setView(true)">日历</button>
        <button type="button" :aria-pressed="!calendar" @click="setView(false)">列表</button>
      </div>
      <div v-if="applicationId && application" class="v4-embedded-interview-controls">
        <p>当前轮次 {{ label(application.stage) }} · {{ label(application.applicationStatus) }}</p>
        <el-button
          type="primary"
          :disabled="
            disabled ||
            loading ||
            !!error ||
            !fresh ||
            v3Session.state.status !== 'ready' ||
            !!gate.current.value ||
            !canSchedule(application, items)
          "
          @click="openEditor($event, null, 'schedule')"
          >安排面试</el-button
        >
        <p v-if="application.applicationStatus !== 'active'">申请已结束，不能安排或变更面试。</p>
        <p v-else-if="!['first_interview', 'second_interview'].includes(application.stage)">
          当前阶段不能安排面试。
        </p>
        <p v-else-if="items.some((row) => row.status === 'scheduled')">
          已有预约，需先完成或取消后再安排下一场。
        </p>
      </div>
    </header>
    <form
      v-if="!applicationId"
      class="v3-card v3-interview-filters v3-filter-toolbar"
      @submit.prevent="filter"
    >
      <div class="v3-filter-field">
        <label for="interview-application-id">申请编号（ID）</label>
        <input
          id="interview-application-id"
          v-model="applicationFilter"
          type="number"
          min="1"
          aria-label="申请 ID"
          placeholder="精确匹配"
        />
      </div>
      <div class="v3-filter-field">
        <label for="interview-position-id">职位编号（ID）</label>
        <input
          id="interview-position-id"
          v-model="positionFilter"
          type="number"
          min="1"
          aria-label="职位 ID"
          placeholder="精确匹配"
        />
      </div>
      <V3FilterSelect
        id="interview-stage"
        v-model="stage"
        label="面试轮次"
        all-label="全部轮次"
        :options="{ first_interview: '初面', second_interview: '复面' }"
      />
      <V3FilterSelect
        id="interview-status"
        v-model="status"
        label="面试状态"
        all-label="全部状态"
        :options="interviewStatus"
      />
      <div class="v3-filter-actions">
        <el-button type="primary" native-type="submit">筛选</el-button>
        <el-button @click="clearFilters">清除筛选</el-button>
      </div>
    </form>
    <p v-if="!applicationId && !calendar" class="v3-applied-filters" role="status">
      已应用：申请 {{ route.query.applicationId || '全部' }} · 职位
      {{ route.query.positionId || '全部' }} · 轮次
      {{ route.query.stageScope ? label(route.query.stageScope as string) : '全部' }} · 状态
      {{ interviewStatus[route.query.status as keyof typeof interviewStatus] || '全部' }}
    </p>
    <Teleport v-if="editor" :disabled="!!applicationId" to="#v4-interview-editor-slot">
      <V3InterviewEditor
        v-if="editor"
        :key="editor.key"
        :application="editor.application"
        :interview="editor.interview"
        :action="editor.action"
        @vue:mounted="editorFocus.enter"
        @close="cancelWithFocus"
        @saved="saved"
      />
    </Teleport>
    <p v-if="operationError && applicationId" class="v3-error" role="alert">{{ operationError }}</p>
    <div v-if="calendar" class="v4-week-main">
      <div v-if="weekStatusMessage" class="v4-week-message" :data-state="weekState" role="status">
        {{ weekStatusMessage }}
        <el-button v-if="weekState === 'failed'" @click="readWeek">重试当前页</el-button>
        <el-button v-if="weekState === 'inconsistent' || weekState === 'budget'" @click="load"
          >重新读取当前范围</el-button
        >
      </div>
      <V4InterviewCalendar
        :start="dateRange.start"
        :end="dateRange.end"
        :mode="calendarMode"
        :anchor="calendarAnchor"
        :rows="weekRows"
        :complete="weekState === 'complete'"
        :selected-event-id="group[0]?.id"
        @navigate="changePeriod"
        @mode="setCalendarMode"
        @day="showDay"
        @select="selectGroup"
      />
    </div>
    <aside
      v-if="!applicationId && panelOpen"
      class="v3-card v4-interview-panel"
      aria-label="面试侧面板"
      @keydown.esc.stop="closePanel()"
    >
      <header>
        <small>{{
          group.length > 1 && !selectedId ? '面试聚合' : editor ? '编辑面试' : '面试详情'
        }}</small
        ><button ref="panelClose" type="button" aria-label="关闭面试侧面板" @click="closePanel()">
          ×
        </button>
      </header>
      <template v-if="group.length > 1 && !selectedId">
        <h2>
          <template v-if="calendarMode !== 'month'">
            {{ group[0].scheduledLocal.slice(11, 16)
            }}{{ group.some((row) => row.scheduledAt !== group[0].scheduledAt) ? ' 附近' : '' }} ·
          </template>
          {{
            weekState === 'complete'
              ? group.length + ' 场面试'
              : '已读取 ' + group.length + ' 场面试'
          }}
        </h2>
        <p class="v4-panel-caption">
          <template v-if="calendarMode !== 'month'"
            >{{ group[0].scheduledLocal.slice(0, 10) }} · </template
          >北京时间
        </p>
        <div class="v4-interview-members">
          <button v-for="row in group" :key="row.id" type="button" @click="selectMeeting(row)">
            <time>{{ row.scheduledLocal.slice(11, 16) }}</time>
            <strong>{{ row.candidateName }}</strong>
            <span class="v4-member-status" :data-status="row.status">{{
              interviewStatus[row.status]
            }}</span>
            <small>{{ row.positionTitle }} · {{ label(row.stageScope) }}</small>
            <span class="v4-member-chevron" aria-hidden="true">›</span>
          </button>
        </div>
        <p class="v4-members-note">按实际开始时间排序</p>
      </template>
      <template v-else>
        <button v-if="group.length > 1" type="button" @click="backToGroup">返回聚合记录</button>
        <p v-if="detailLoading" role="status">正在读取面试详情…</p>
        <div v-else-if="detailError" role="alert">
          {{ detailError }} <el-button @click="loadMeeting">重试详情</el-button>
        </div>
        <template v-else-if="meeting">
          <div class="v4-panel-identity">
            <span class="v4-panel-avatar" aria-hidden="true">{{
              Array.from(meeting.candidateName.replace(/^\[虚构演示\]\s*/, '').trim() || '申')[0]
            }}</span>
            <div>
              <h2>{{ meeting.candidateName || '姓名未记录' }}</h2>
              <small>申请 #{{ meeting.applicationId }} · 面试 #{{ meeting.id }}</small>
            </div>
            <span class="v3-state-label" :data-status="meeting.status">{{
              interviewStatus[meeting.status]
            }}</span>
          </div>
          <div class="v4-panel-time">
            <span class="v4-calendar-glyph" aria-hidden="true"
              ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
                <rect x="4" y="6" width="16" height="14" rx="2" />
                <path d="M8 3v5m8-5v5M4 11h16" /></svg
            ></span>
            <div>
              <small>{{ editor ? '原预约开始时间' : '预约开始时间' }}</small
              ><strong>{{ meeting.scheduledLocal.slice(0, 16).replace('T', ' ') }}</strong
              ><small>北京时间 UTC+8</small>
            </div>
          </div>
          <dl class="v4-panel-facts">
            <dt>关联职位</dt>
            <dd>{{ meeting.positionTitle }} · #{{ meeting.positionId }}</dd>
            <dt>面试轮次</dt>
            <dd>{{ label(meeting.stageScope) }}</dd>
            <dt>面试官</dt>
            <dd>{{ meeting.interviewerName }}</dd>
            <dt>面试备注</dt>
            <dd>{{ meeting.note || '未记录' }}</dd>
            <template v-if="meeting.cancelReason"
              ><dt>取消原因</dt>
              <dd>{{ meeting.cancelReason }}</dd></template
            >
          </dl>
          <p v-if="meeting.reminder" class="v3-reminder">{{ meeting.reminder }}</p>
          <div v-if="!editor" class="v4-panel-actions">
            <el-button
              v-for="action in actions"
              :key="action"
              :disabled="!canChangeInterview(meeting)"
              @click="openEditor($event, meeting, action)"
              >{{ interviewAction[action] }}</el-button
            >
          </div>
          <p v-if="meeting.applicationStatus !== 'active' || meeting.status !== 'scheduled'">
            该记录仅供查看。
          </p>
          <RouterLink :to="'/candidates/' + meeting.applicationId">查看申请详情</RouterLink>
        </template>
      </template>
      <p v-if="operationError" class="v3-error" role="alert">{{ operationError }}</p>
      <div id="v4-interview-editor-slot" />
    </aside>
    <template v-if="!calendar">
      <section
        v-if="loading && !applicationId"
        class="v3-card v3-interview-loading"
        aria-busy="true"
        aria-labelledby="interview-loading-title"
      >
        <h2 id="interview-loading-title">面试记录</h2>
        <V3TableScroll name="面试记录表格">
          <table aria-label="面试记录加载中">
            <thead>
              <tr>
                <th v-for="column in interviewColumns" :key="column" scope="col">{{ column }}</th>
              </tr>
            </thead>
            <tbody aria-hidden="true">
              <tr v-for="row in 5" :key="row" class="v3-interview-loading-row">
                <td v-for="column in interviewColumns" :key="column">
                  <span class="v3-interview-loading-cell" />
                </td>
              </tr>
            </tbody>
          </table>
        </V3TableScroll>
        <p role="status">加载面试记录中，请稍候…</p>
      </section>
      <V3Feedback v-else-if="loading" state="loading" title="加载面试记录中" />
      <V3Feedback
        v-else-if="error"
        state="error"
        title="暂时无法查看面试记录"
        :message="error"
        action="重新加载"
        @action="load"
      />
      <V3Feedback
        v-else-if="!items.length && !$slots['embedded-records']"
        :action="!applicationId && offset > 0 ? '返回第一页' : filtered ? '清除筛选' : undefined"
        state="empty"
        :title="
          total > 0 ? '本页暂无面试记录' : filtered ? '没有匹配的面试记录' : '暂时没有面试记录'
        "
        :message="
          applicationId
            ? '可从符合条件的当前轮次安排面试。'
            : '请调整筛选条件，或从申请详情安排面试。'
        "
        @action="
          router.push({
            path: '/interviews',
            query: offset > 0 ? { ...route.query, offset: 0 } : { view: 'list' }
          })
        "
      />
      <section v-else-if="!$slots['embedded-records']" class="v3-card">
        <h2>
          面试记录 <small>共 {{ total }} 场</small>
        </h2>
        <V3TableScroll name="面试记录表格">
          <table aria-label="面试记录">
            <thead>
              <tr>
                <th scope="col">面试 / 申请</th>
                <th scope="col">应聘职位</th>
                <th scope="col">轮次</th>
                <th scope="col">预约开始时间（北京时间）</th>
                <th scope="col">面试官</th>
                <th scope="col">状态</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in displayedInterviews" :key="row.id" :data-interview-id="row.id">
                <td>
                  #{{ row.id
                  }}<RouterLink :to="'/candidates/' + row.applicationId"
                    >{{ row.candidateName }} · 申请 #{{ row.applicationId }}</RouterLink
                  >
                </td>
                <td>{{ row.positionTitle }} · #{{ row.positionId }}</td>
                <td>
                  {{ label(row.stageScope)
                  }}<small v-if="applicationId">{{
                    row.stageScope === application?.stage ? '当前轮' : '历史轮次'
                  }}</small>
                </td>
                <td>
                  {{ row.scheduledLocal.replace('T', ' ').replace('+08:00', '')
                  }}<small>{{ row.businessTimeZone }}</small>
                  <p
                    v-if="row.status === 'scheduled' && row.startTimeReached"
                    class="v3-reminder"
                    role="status"
                  >
                    {{ row.reminder }}
                  </p>
                </td>
                <td>{{ row.interviewerName }}</td>
                <td>
                  <span class="v3-state-label" :data-state="row.status">{{
                    interviewStatus[row.status]
                  }}</span
                  ><small v-if="row.cancelReason">原因 {{ row.cancelReason }}</small>
                </td>
                <td>
                  <el-button v-if="!applicationId" text @click="selectGroup([row], $event)"
                    >查看详情</el-button
                  >
                  <el-button
                    v-for="action in actions"
                    v-else
                    :key="action"
                    text
                    :disabled="!canChangeInterview(row)"
                    @click="openEditor($event, row, action)"
                    >{{ interviewAction[action] }}</el-button
                  >
                </td>
              </tr>
            </tbody>
          </table>
        </V3TableScroll>
        <div v-if="!applicationId" class="v3-interview-actions">
          <el-button :disabled="offset === 0" @click="page(-20)">上一页</el-button
          ><span>{{ offset + 1 }}–{{ Math.min(offset + 20, total) }} / {{ total }}</span
          ><el-button :disabled="offset + 20 >= total" @click="page(20)">下一页</el-button>
        </div>
      </section>
    </template>
    <slot
      name="embedded-records"
      :items="items"
      :open-editor="openEditor"
      :can-change="canChangeInterview"
    />
  </section>
</template>
<script setup lang="ts">
import { useEditorFocus } from '../utils/v3-editor-focus'
import V3TableScroll from '../components/V3TableScroll.vue'
import { computed, inject, nextTick, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { readV3, v3Session } from '../api/request-v3'
import { createEditorGate, editorGateKey } from '../utils/v3-editor-gate'
import { latestRead } from '../api/v3-operation'
import { label, type Application, type Page } from '../api/recruiting-v3'
import {
  canSchedule,
  interviewQuery,
  interviewStatus,
  interviewAction,
  type Interview,
  type InterviewAction
} from '../api/interview-v3'
import V3FilterSelect from '../components/V3FilterSelect.vue'
import V3Feedback from '../components/V3Feedback.vue'
import V3InterviewEditor from '../components/V3InterviewEditor.vue'
import V4InterviewCalendar from '../components/V4InterviewCalendar.vue'
import {
  calendarRange,
  createCalendarReader,
  shiftCalendar,
  weekPageLimit,
  shanghaiDay,
  type CalendarMode
} from '../api/v4-interview-week'
import { confirmV3Leave } from '../router/v3-drafts'
import '../styles/v3-interviews.scss'
import '../styles/v4-interviews.scss'
const props = defineProps<{ applicationId?: number; disabled?: boolean; refreshToken?: number }>()
const emit = defineEmits<{ editing: [boolean]; updated: [] }>()
const gate = inject(editorGateKey, null) ?? createEditorGate()
let lease: symbol | null = null
let alive = true
const fresh = ref(false)
const route = useRoute(),
  router = useRouter()
const calendar = computed(() => !props.applicationId && route.query.view !== 'list')
const calendarMode = computed<CalendarMode>(() =>
  !props.applicationId && (route.query.view === 'day' || route.query.view === 'month')
    ? route.query.view
    : 'week'
)
const calendarAnchor = computed(() => {
  const day = route.query.date
  if (!props.applicationId && typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const anchor = Date.parse(day + 'T00:00:00+08:00')
    if (Number.isFinite(anchor) && shanghaiDay(anchor) === day) return anchor
  }
  // Track the route, rather than reapplying the preference on data refresh.
  return Date.now()
})
const dateRange = computed(() => calendarRange(calendarAnchor.value, calendarMode.value))
const lastCalendarMode = ref(calendarMode.value)
watch([calendar, calendarMode], ([visible, mode]) => {
  if (visible) lastCalendarMode.value = mode
})
const periodName = computed(
  () => ({ day: '当天', week: '本周', month: '当前月历范围' })[calendarMode.value]
)
const weekRows = ref<Interview[]>([])
const weekState = ref<'reading' | 'complete' | 'failed' | 'inconsistent' | 'budget'>('complete')
const weekError = ref('')
let weekGeneration = 0
let reader = createCalendarReader(dateRange.value.start, dateRange.value.end)
const weekStatusMessage = computed(() => {
  if (weekState.value === 'reading') return '正在读取' + periodName.value + '面试…'
  if (weekState.value === 'inconsistent') return '分页发生变化，当前仅显示已确认的部分数据。'
  if (weekState.value === 'budget')
    return '已达读取上限，无法确认当前范围完整覆盖。可缩小筛选范围或切换全局列表。'
  if (weekState.value === 'failed')
    return (
      (reader.offset ? '仅显示已读取的部分数据。' : '无法读取当前范围的面试。') + weekError.value
    )
  if (!weekRows.value.length)
    return periodName.value + (filtered.value ? '没有匹配的面试。' : '暂无面试。')
  return ''
})
async function readWeek() {
  if (!calendar.value || weekState.value === 'reading') return
  const attempt = ++weekGeneration
  const owner = v3Session.version()
  const query = new URLSearchParams(interviewQuery(route.query))
  query.set('limit', String(weekPageLimit))
  const current = () =>
    alive && calendar.value && attempt === weekGeneration && owner === v3Session.version()
  weekState.value = 'reading'
  try {
    while (current()) {
      query.set('offset', String(reader.offset))
      const page = await readV3<Page<Interview>>('/interviews?' + query)
      if (!current()) return
      const result = reader.accept(page)
      weekRows.value = result.rows
      weekState.value = result.state
      if (result.state !== 'reading') return
    }
  } catch (failure) {
    if (!current()) return
    weekError.value = failure instanceof Error ? failure.message : '读取失败'
    weekState.value = 'failed'
  }
}
function setView(useCalendar: boolean) {
  if (useCalendar === calendar.value) return
  void router.push({
    path: '/interviews',
    query: {
      ...route.query,
      offset: undefined,
      view: useCalendar ? lastCalendarMode.value : 'list'
    }
  })
}
const group = ref<Interview[]>([])
const selectedId = ref<number>()
const meeting = ref<Interview | null>(null)
const panelOpen = computed(() => group.value.length > 0 || selectedId.value !== undefined)
const panelClose = ref<HTMLButtonElement>()
const detailLoading = ref(false)
const detailError = ref('')
const panelReads = latestRead()
let panelOpener: HTMLElement | null = null
function leavePanel() {
  if (!confirmV3Leave()) return false
  if (editor.value || opening.value) void closeEditor()
  return true
}
function resetPanel() {
  panelReads.invalidate()
  selectedId.value = undefined
  group.value = []
  meeting.value = null
  detailError.value = operationError.value = ''
  detailLoading.value = false
}
function closePanel() {
  if (!leavePanel()) return
  const opener = panelOpener
  resetPanel()
  void nextTick(() =>
    opener?.focus({ preventScroll: !window.matchMedia('(max-width: 1119px)').matches })
  )
}
function changeCalendar(anchor: number, mode: CalendarMode) {
  void router.push({
    path: '/interviews',
    query: { ...route.query, view: mode, date: shanghaiDay(anchor), offset: undefined }
  })
}
function changePeriod(direction: number) {
  changeCalendar(
    direction === 0
      ? Date.now()
      : shiftCalendar(calendarAnchor.value, calendarMode.value, direction),
    calendarMode.value
  )
}
function setCalendarMode(mode: CalendarMode) {
  changeCalendar(calendarAnchor.value, mode)
}
function showDay(day: number) {
  changeCalendar(day, 'day')
}
function selectGroup(members: Interview[], event: MouseEvent) {
  if (!leavePanel()) return
  resetPanel()
  panelOpener = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
  group.value = members
  if (members.length === 1) void selectMeeting(members[0])
  else void nextTick(focusPanel)
}
function focusPanel() {
  const close = panelClose.value
  close?.focus({ preventScroll: true })
  if (window.matchMedia('(max-width: 1119px)').matches) close?.scrollIntoView({ block: 'nearest' })
}
function selectMeeting(row: Interview) {
  selectedId.value = row.id
  void loadMeeting()
  void nextTick(focusPanel)
}
function backToGroup() {
  if (!leavePanel()) return
  panelReads.invalidate()
  selectedId.value = undefined
  meeting.value = null
  detailLoading.value = false
  detailError.value = operationError.value = ''
}
function loadMeeting() {
  const id = selectedId.value
  if (id === undefined) return
  const owner = v3Session.version()
  detailError.value = ''
  detailLoading.value = true
  return panelReads.execute(
    () => readV3<Interview>('/interviews/' + id),
    (row) => {
      if (owner !== v3Session.version()) return
      meeting.value = row
      detailLoading.value = false
    },
    (failure) => {
      if (owner !== v3Session.version()) return
      meeting.value = null
      detailError.value = failure instanceof Error ? failure.message : '面试详情读取失败'
      detailLoading.value = false
    }
  )
}
const items = ref<Interview[]>([]),
  application = ref<Application | null>(null),
  total = ref(0)
const displayedInterviews = computed(() => {
  if (!props.applicationId || !application.value) return items.value
  const stage = application.value.stage
  return [
    ...items.value.filter((row) => row.stageScope === stage),
    ...items.value.filter((row) => row.stageScope !== stage)
  ]
})
const loading = ref(false),
  error = ref(''),
  operationError = ref(''),
  opening = ref(false)
const applicationFilter = ref(''),
  positionFilter = ref(''),
  stage = ref(''),
  status = ref('')
const offset = computed(() =>
  Number(new URLSearchParams(interviewQuery(route.query)).get('offset'))
)
const filtered = computed(
  () =>
    !props.applicationId &&
    ['applicationId', 'positionId', 'stageScope', 'status'].some((key) => route.query[key])
)
const interviewColumns = [
  '面试 / 申请',
  '应聘职位',
  '轮次',
  '预约开始时间（北京时间）',
  '面试官',
  '状态',
  '操作'
]
const actions: Exclude<InterviewAction, 'schedule'>[] = ['reschedule', 'complete', 'cancel']
const editor = ref<{
  application: Application
  interview: Interview | null
  action: InterviewAction
  key: number
} | null>(null)
let generation = 0,
  editorKey = 0
const reads = latestRead()
const dataReady = computed(() =>
  calendar.value
    ? !!meeting.value && !detailLoading.value && !detailError.value
    : fresh.value && !error.value && !loading.value
)
function canChangeInterview(row: Interview) {
  return (
    row.status === 'scheduled' &&
    row.applicationStatus === 'active' &&
    dataReady.value &&
    v3Session.state.status === 'ready' &&
    !gate.current.value &&
    !editor.value &&
    !opening.value &&
    !props.disabled
  )
}
function load() {
  if (editor.value || opening.value || props.disabled) return
  if (calendar.value) {
    reader = createCalendarReader(dateRange.value.start, dateRange.value.end)
    weekRows.value = []
    weekState.value = 'complete'
    return readWeek()
  }
  fresh.value = false
  application.value = null
  loading.value = true
  error.value = ''
  items.value = []
  return reads.execute(
    async () => {
      if (props.applicationId) {
        const [rows, app] = await Promise.all([
          readV3<Interview[]>('/applications/' + props.applicationId + '/interviews'),
          readV3<Application>('/applications/' + props.applicationId)
        ])
        return { items: rows, total: rows.length, app }
      }
      const page = await readV3<Page<Interview>>('/interviews?' + interviewQuery(route.query))
      return { ...page, app: null }
    },
    (result) => {
      fresh.value = true
      items.value = result.items
      total.value = result.total
      application.value = result.app
      loading.value = false
    },
    (e) => {
      error.value = e instanceof Error ? e.message : '读取失败'
      loading.value = false
    }
  )
}
async function openEditor(event: MouseEvent, row: Interview | null, action: InterviewAction) {
  if (
    editor.value ||
    opening.value ||
    props.disabled ||
    !dataReady.value ||
    v3Session.state.status !== 'ready'
  )
    return
  const acquired = gate.acquire()
  if (!acquired) return
  lease = acquired
  editorFocus.remember(event)
  const path = route.fullPath
  const attempt = ++generation,
    owner = v3Session.version()
  opening.value = true
  operationError.value = ''
  try {
    const id = row?.applicationId ?? props.applicationId!
    const [app, meeting, appointments] = await Promise.all([
      readV3<Application>('/applications/' + id),
      row ? readV3<Interview>('/interviews/' + row.id) : Promise.resolve(null),
      row
        ? Promise.resolve([] as Interview[])
        : readV3<Interview[]>('/applications/' + id + '/interviews')
    ])
    if (
      !alive ||
      !gate.owns(acquired) ||
      lease !== acquired ||
      props.disabled ||
      !dataReady.value ||
      route.fullPath !== path ||
      attempt !== generation ||
      owner !== v3Session.version() ||
      v3Session.state.status !== 'ready'
    )
      return
    if (
      app.applicationStatus !== 'active' ||
      (action === 'schedule' ? !canSchedule(app, appointments) : meeting?.status !== 'scheduled')
    )
      throw new Error('服务器当前状态不允许该面试操作，请刷新记录。')
    editor.value = { application: app, interview: meeting, action, key: ++editorKey }
    emit('editing', true)
  } catch (e) {
    if (alive && attempt === generation && owner === v3Session.version() && route.fullPath === path)
      operationError.value = e instanceof Error ? e.message : '无法打开操作'
  } finally {
    if (attempt === generation) opening.value = false
    if (!editor.value) {
      gate.release(acquired)
      if (lease === acquired) lease = null
    }
  }
}
const editorFocus = useEditorFocus('.v3-interviews')
async function cancelWithFocus() {
  await closeEditor()
  await editorFocus.restore()
}
async function closeEditor() {
  const releasing = lease
  generation++
  opening.value = false
  editor.value = null
  emit('editing', false)
  await nextTick()
  if (releasing) gate.release(releasing)
  if (lease === releasing) lease = null
}
function saved() {
  void closeEditor().then(editorFocus.restore)
  void load()
  if (!props.applicationId && selectedId.value !== undefined) {
    group.value = []
    void loadMeeting()
  }
  emit('updated')
}
function filter() {
  const query: Record<string, string> = { view: calendar.value ? calendarMode.value : 'list' }
  if (calendar.value && typeof route.query.date === 'string') query.date = route.query.date
  for (const [key, value] of [
    ['applicationId', applicationFilter.value],
    ['positionId', positionFilter.value],
    ['stageScope', stage.value],
    ['status', status.value]
  ])
    if (value) query[key] = value
  void router.push({ path: '/interviews', query })
}
function clearFilters() {
  applicationFilter.value = positionFilter.value = stage.value = status.value = ''
  void router.push({
    path: '/interviews',
    query: {
      view: calendar.value ? calendarMode.value : 'list',
      date: calendar.value ? route.query.date : undefined
    }
  })
}
function page(amount: number) {
  void router.push({
    path: '/interviews',
    query: { ...route.query, offset: offset.value + amount }
  })
}
watch(
  () => [props.applicationId, route.fullPath],
  () => {
    generation++
    reads.invalidate()
    weekGeneration++
    resetPanel()
    closeEditor()
    applicationFilter.value = String(route.query.applicationId ?? '')
    positionFilter.value = String(route.query.positionId ?? '')
    stage.value = String(route.query.stageScope ?? '')
    status.value = String(route.query.status ?? '')
    void load()
  },
  { immediate: true }
)
const refreshTimer = window.setInterval(() => {
  if (
    !loading.value &&
    (!calendar.value || weekState.value === 'complete') &&
    !editor.value &&
    !opening.value &&
    !props.disabled &&
    !gate.current.value &&
    v3Session.state.status === 'ready' &&
    document.visibilityState === 'visible'
  )
    void load()
}, 30000)
watch(
  () => props.refreshToken,
  () => {
    if (!props.disabled && !gate.current.value) void load()
  }
)
onUnmounted(() => {
  editorFocus.clear()
  alive = false
  if (lease) gate.release(lease)
  window.clearInterval(refreshTimer)
  generation++
  reads.invalidate()
  panelReads.invalidate()
  weekGeneration++
  emit('editing', false)
})
</script>
