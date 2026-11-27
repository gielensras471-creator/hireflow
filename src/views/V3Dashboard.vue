<template>
  <section class="v3-dashboard">
    <header class="v3-dashboard-heading">
      <h1>招聘工作台</h1>
      <div v-if="summaryLoading" class="v3-dashboard-metrics" aria-busy="true">
        <span role="status">读取指标中…</span>
      </div>
      <div v-else-if="summary" class="v3-dashboard-metrics" aria-label="工作台指标">
        <article v-for="m in metrics" :key="m.key">
          <h2>{{ m.title }}</h2>
          <strong :data-metric="m.key" :title="m.unit">{{ m.count }}</strong>
        </article>
      </div>
      <div class="v4-dash-actions">
        <button class="v4-dash-button" type="button" :disabled="!ready" @click="refreshAll">
          刷新工作台
        </button>
        <RouterLink class="v4-dash-button" to="/candidates">→ 查看申请</RouterLink>
        <button
          class="v4-dash-button is-primary"
          type="button"
          :disabled="!ready || !!editor"
          @click="openEditor($event, null)"
        >
          ＋ 新建职位
        </button>
      </div>
    </header>
    <V3Feedback
      v-if="summaryError"
      state="error"
      title="暂时无法查看工作台指标"
      :message="summaryError"
      action="重试指标"
      @action="loadSummary"
    />
    <V3RecruitingEditor
      v-if="editor"
      positions
      :options="[]"
      :row="editor.row"
      :action="editor.action"
      @vue:mounted="editorFocus.enter"
      @close="closeEditor"
      @saved="savedPosition"
    />
    <section class="v4-dash-core" aria-label="招聘核心数据">
      <V4DashboardTrend
        :trend="history?.applications"
        :loading="historyLoading"
        :error="historyError"
        @retry="loadHistory"
      />
      <section class="v3-card v4-dash-reminders">
        <header><h2>招聘待办提醒</h2></header>
        <p class="v3-dashboard-note">查看当前需要跟进的事项</p>
        <div class="v4-dash-stack">
          <button
            v-for="key in highlights"
            :key="key"
            type="button"
            class="v4-dash-stack-item"
            :data-highlight="key"
            :aria-controls="'dashboard-work-details'"
            @click="selectAndReveal(key)"
          >
            <span class="v4-dash-round" aria-hidden="true">{{ highlightIcons[key] }}</span>
            <span
              ><b>{{ workLabels[key] }}</b
              ><small>{{
                summary
                  ? summary.work[key].count + ' ' + unitLabel(summary.work[key].unit)
                  : '暂不可用'
              }}</small></span
            >
            <span aria-hidden="true">›</span>
          </button>
        </div>
        <button class="v4-dash-link" type="button" @click="reveal('dashboard-all-work')">
          查看全部待办 ↗
        </button>
      </section>
      <section class="v3-card v4-dash-progress">
        <header><h2>招聘进展</h2></header>
        <div class="v4-dash-inset">
          <h3>本月 Offer 事件</h3>
          <p v-if="historyLoading" role="status">正在读取…</p>
          <template v-else-if="history">
            <dl class="v4-dash-values">
              <div>
                <dt>发送</dt>
                <dd>{{ history.offer.sent ?? '—' }}</dd>
              </div>
              <div>
                <dt>回应</dt>
                <dd>{{ history.offer.responded ?? '—' }}</dd>
              </div>
            </dl>
            <p v-if="history.offer.coverage === 'partial'" class="v3-dashboard-note">
              仅统计已记录事件，历史覆盖待核实。
            </p>
          </template>
          <p v-else>
            历史统计不可用。
            <button v-if="historyError" class="v4-dash-link" type="button" @click="loadHistory">
              重试
            </button>
          </p>
        </div>
        <div class="v4-dash-inset">
          <h3>当前申请阶段</h3>
          <dl class="v4-dash-values">
            <div v-for="(value, name) in phaseTotals" :key="name">
              <dt>{{ name }}</dt>
              <dd>{{ value ?? '—' }}</dd>
            </div>
          </dl>
          <p v-if="phaseLoading" role="status">正在读取阶段统计…</p>
          <p v-else-if="phaseIssue" class="v3-dashboard-note" role="status">
            {{ phaseIssue }}
            <button class="v4-dash-link" type="button" @click="loadPhases">重试阶段</button>
          </p>
        </div>
      </section>
    </section>
    <section class="v4-dash-open">
      <header>
        <h2>开放职位</h2>
        <div class="v4-dash-actions">
          <span class="v4-dash-range">最近发布</span
          ><RouterLink class="v4-dash-button" to="/positions">→ 查看全部</RouterLink>
        </div>
      </header>
      <p v-if="positionsLoading" role="status">正在读取开放职位…</p>
      <p v-else-if="positionError" role="status">
        {{ positionError }}
        <button class="v4-dash-link" type="button" @click="loadPositions">重试职位</button>
      </p>
      <p v-else-if="!positions.length">暂无未归档的开放职位。</p>
      <div v-else class="v4-dash-positions">
        <article v-for="row in positions" :key="row.id" class="v3-card v4-dash-job">
          <header>
            <h3><span aria-hidden="true">●</span> {{ row.title }}</h3>
            <V4PositionMenu
              :row="row"
              :disabled="!!editor || !ready"
              @action="(event, action, opener) => openEditor(event, row, action, opener)"
            />
          </header>
          <p>{{ row.department || '—' }} · {{ row.location || '—' }}</p>
          <p class="v4-dash-job-id">
            <span class="v4-dash-job-icon" aria-hidden="true">▣</span> 职位 #{{ row.id }}
            <span class="v4-dash-job-open">招聘中</span>
          </p>
          <dl class="v4-dash-values v4-dash-inset v4-dash-job-stats">
            <div>
              <dt>累计申请记录 · 条</dt>
              <dd>{{ row.applicationRecords }}</dd>
            </div>
            <div>
              <dt>已完成面试 · 场</dt>
              <dd>
                {{ completed[row.id] === undefined ? '读取中' : completed[row.id] ?? '不可用' }}
              </dd>
              <button
                v-if="completed[row.id] === null"
                class="v4-dash-link"
                type="button"
                @click="loadCompleted(row.id)"
              >
                重试场次
              </button>
            </div>
          </dl>
          <footer>
            <small>发布日期 {{ row.publishDate || '—' }}</small
            ><RouterLink
              class="v4-dash-link"
              :to="positionLink(row.id, route.fullPath)"
              :data-position-link="row.id"
              @click="rememberPosition($event, route.fullPath, row.id)"
              >查看详情 ›</RouterLink
            >
          </footer>
        </article>
      </div>
      <p v-if="summary" class="v3-dashboard-note v3-dashboard-metric-note">
        开放职位含
        {{ summary.openPositions.softDeletedOpen }}
        个已归档的开放记录。下方卡片只展示未归档开放职位。申请数按申请记录统计。指标读取时间：{{
          feedbackTime(summary.now)
        }}。
      </p>
    </section>

    <section v-if="summary" id="dashboard-all-work" class="v3-card" tabindex="-1">
      <h2>需要处理的工作</h2>
      <div class="v3-dashboard-work">
        <button
          v-for="key in allWork"
          :key="key"
          type="button"
          :data-work="key"
          :aria-pressed="type === key"
          :class="{ 'is-selected': type === key }"
          @click="select(key)"
        >
          <span class="v3-work-selection" aria-hidden="true">✓ 已选中</span>
          <span>{{ workLabels[key] }}</span>
          <strong>{{ summary.work[key].count }}</strong>
          <small>{{ unitLabel(summary.work[key].unit) }}</small>
        </button>
      </div>
      <p class="v3-dashboard-note">
        类别独立计量，申请级与面试级待办不合计为人数。到时只提醒人工确认。
      </p>
    </section>
    <section
      id="dashboard-work-details"
      tabindex="-1"
      class="v3-card v3-dashboard-details"
      :aria-busy="workLoading"
    >
      <header>
        <h2>待处理事项 · {{ workLabels[type] }}</h2>
        <el-button :disabled="!ready" @click="refreshWork">刷新待办</el-button>
      </header>
      <div class="v3-filter-toolbar v3-dashboard-filters">
        <V3FilterSelect
          id="dashboard-work-type"
          :model-value="type"
          label="待办类别"
          :options="workLabels"
          @update:model-value="select($event as WorkType)"
        />
        <V3FilterSelect
          v-if="type === 'offer'"
          id="dashboard-offer-status"
          v-model="offerStatus"
          label="Offer 子状态"
          all-label="全部活跃 Offer"
          :options="offerLabels"
          @update:model-value="changeOffer"
        />
      </div>
      <template v-if="workLoading"
        ><V3DashboardTable :items="[]" loading />
        <p role="status">加载待办明细中…</p></template
      >
      <V3Feedback
        v-else-if="workError"
        state="error"
        title="暂时无法查看待办"
        :message="workError"
        action="重试待办"
        @action="refreshWork"
      />
      <V3Feedback
        v-else-if="!work?.items.length"
        state="empty"
        title="当前页暂无待办"
        :message="work?.total ? '可返回前一页查看。' : '当前类别没有需要处理的记录。'"
      />
      <V3DashboardTable
        v-else
        :items="work.items"
        :loading="false"
        :identities="identities"
        :identity-state="identityState"
      />
      <div v-if="work" class="v3-dashboard-pager">
        <el-button :disabled="offset === 0 || workLoading" @click="page(-10)">上一页待办</el-button
        ><span
          >{{
            work.items.length
              ? '第 ' + (offset + 1) + '–' + (offset + work.items.length) + ' 条，'
              : '本页暂无记录，'
          }}共 {{ work.total }} {{ unitLabel(work.unit) }}</span
        ><el-button :disabled="offset + 10 >= work.total || workLoading" @click="page(10)"
          >下一页待办</el-button
        >
      </div>
    </section>
    <div class="v3-dashboard-bottom">
      <section class="v3-card v3-dashboard-today" :aria-busy="todayLoading">
        <header>
          <h2>今日面试</h2>
          <el-button :disabled="!ready" @click="refreshToday">刷新今日面试</el-button>
        </header>
        <template v-if="todayLoading"
          ><V3DashboardTable :items="[]" loading today />
          <p role="status">加载今日面试中…</p></template
        >
        <V3Feedback
          v-else-if="todayError"
          state="error"
          title="暂时无法查看今日面试"
          :message="todayError"
          action="重试今日面试"
          @action="refreshToday"
        />
        <template v-else-if="today"
          ><p>
            {{ feedbackTime(today.start) }} 起，至下一日零点前 · 共 {{ today.total }} 场；待进行
            {{ today.byStatus.scheduled }}、已完成 {{ today.byStatus.completed }}、已取消
            {{ today.byStatus.cancelled }}
          </p>
          <V3Feedback
            v-if="!today.items.length"
            state="empty"
            title="当前页暂无今日面试"
          /><V3DashboardTable
            v-else
            :items="today.items"
            :loading="false"
            today
            :identities="identities"
            :identity-state="identityState"
          />
          <div class="v3-dashboard-pager">
            <el-button :disabled="todayOffset === 0" @click="todayPage(-10)">上一页面试</el-button
            ><el-button :disabled="todayOffset + 10 >= today.total" @click="todayPage(10)"
              >下一页面试</el-button
            >
          </div></template
        >
      </section>
      <section class="v3-card v3-dashboard-stats">
        <header><h2>辅助统计</h2></header>
        <template v-if="summary">
          <section class="v3-stat-group" aria-labelledby="dashboard-stat-applications">
            <div class="v3-stat-heading">
              <h3 id="dashboard-stat-applications">申请记录分布</h3>
              <small>共 {{ summary.applicationTotals.total }} 条</small>
            </div>
            <dl class="v3-stat-list">
              <div
                v-for="(text, key) in {
                  active: '进行中',
                  closed: '已结束',
                  hired: '其中已确认录用'
                }"
                :key="key"
                class="v3-dashboard-bar"
                :data-application-stat="key"
              >
                <dt>{{ text }}</dt>
                <dd>{{ summary.applicationTotals[key] }} <span>条</span></dd>
                <dd class="v3-dashboard-application-meter">
                  <meter
                    :value="summary.applicationTotals[key]"
                    :max="Math.max(summary.applicationTotals.total, 1)"
                    :aria-label="text"
                  />
                </dd>
              </div>
            </dl>
          </section>
          <section class="v3-stat-group" aria-labelledby="dashboard-stat-offer">
            <h3 id="dashboard-stat-offer">活跃 Offer 分布</h3>
            <div class="v3-stat-offers">
              <button
                v-for="(text, key) in offerLabels"
                :key="key"
                class="v3-dashboard-offer"
                :data-offer-stat="key"
                type="button"
                @click="selectOffer(key)"
              >
                <span>{{ text }}</span>
                <span>{{ summary.offerByStatus[key] }} <small>条申请</small></span>
              </button>
            </div>
          </section>
          <section class="v3-stat-group" aria-labelledby="dashboard-stat-work">
            <h3 id="dashboard-stat-work">待办分类</h3>
            <dl class="v3-stat-list">
              <div
                v-for="(text, key) in workLabels"
                :key="key"
                class="v3-stat-row"
                :data-work-stat="key"
              >
                <dt>{{ text }}</dt>
                <dd>
                  {{ summary.work[key].count }} <span>{{ unitLabel(summary.work[key].unit) }}</span>
                </dd>
              </div>
            </dl>
          </section>
        </template>
        <p v-else>指标未成功读取，统计暂不可用。</p>
      </section>
    </div>
    <p class="v3-dashboard-note">
      指标、明细、今日面试分别读取，可能存在短暂差异，不属于同一数据库事务快照。
    </p>
  </section>
</template>
<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { readV3, v3Session } from '../api/request-v3'
import { latestRead } from '../api/v3-operation'
import {
  workLabels,
  offerLabels,
  unitLabel,
  workPath,
  type WorkType,
  type Summary,
  type HistoryMetrics,
  type WorkPage,
  type Today
} from '../api/dashboard-v3'
import type { Application, Page, Position } from '../api/recruiting-v3'
import { feedbackTime } from '../api/feedback-v3'
import V3FilterSelect from '../components/V3FilterSelect.vue'
import V3Feedback from '../components/V3Feedback.vue'
import V3DashboardTable from '../components/V3DashboardTable.vue'
import V4DashboardTrend from '../components/V4DashboardTrend.vue'
import V4PositionMenu from '../components/V4PositionMenu.vue'
import V3RecruitingEditor from '../components/V3RecruitingEditor.vue'
import { useEditorFocus } from '../utils/v3-editor-focus'
import { byPublishDate, collectPositions, recruitingStages } from '../api/v4-recruiting-lists'
import '../styles/v3-dashboard.scss'
import '../styles/v4-dashboard.scss'
import { useRoute } from 'vue-router'
import { positionLink, rememberPosition, restorePosition } from '../router/v4-position-navigation'
const route = useRoute()
const ready = computed(() => v3Session.state.status === 'ready')
const summary = ref<Summary | null>(null),
  work = ref<WorkPage | null>(null),
  today = ref<Today | null>(null)
type Identity = Pick<Application, 'name' | 'positionId' | 'positionTitle'>
const identities = ref(new Map<number, Identity>())
const identityState = ref<'loading' | 'ready' | 'error'>('loading')
const summaryLoading = ref(false),
  workLoading = ref(false),
  todayLoading = ref(false),
  summaryError = ref(''),
  workError = ref(''),
  todayError = ref('')
const type = ref<WorkType>('screening'),
  offerStatus = ref(''),
  offset = ref(0),
  todayOffset = ref(0)
const sr = latestRead(),
  wr = latestRead(),
  tr = latestRead()

const highlights = ['screening', 'feedback', 'offer'] as const
const highlightIcons = { screening: '⌕', feedback: '✎', offer: '▣' }
const allWork = Object.keys(workLabels) as WorkType[]
const history = ref<HistoryMetrics | null>(null)
const historyLoading = ref(false)
const historyError = ref('')
const phases = ref<(number | null)[]>([])
const phaseLoading = ref(false)
const phaseTotals = computed(() => ({
  待筛选: phases.value[0] ?? null,
  面试中:
    phases.value[1] == null || phases.value[2] == null ? null : phases.value[1] + phases.value[2],
  'Offer 中': phases.value[3] ?? null
}))
const phaseIssue = computed(() => {
  if (!phases.value.length) return '阶段统计暂不可用。'
  if (phases.value.some((v) => v === null)) return '部分阶段读取失败。'
  if (
    summary.value &&
    phases.value.reduce<number>((sum, v) => sum + (v ?? 0), 0) !==
      summary.value.activeApplications.count
  )
    return '独立读取的阶段计数与汇总有差异，请刷新核对。'
  return ''
})
const positions = ref<Position[]>([])
const positionsLoading = ref(false)
const positionError = ref('')
const completed = ref<Record<number, number | null>>({})
const editor = ref<{ row: Position | null; action: 'edit' | 'status' | 'archive' } | null>(null)
const editorFocus = useEditorFocus('.v3-dashboard')
const historyRead = latestRead()
const phaseRead = latestRead()
const positionRead = latestRead()
let positionRun = 0
const runningCounts = new Map<number, object>()

function loadHistory() {
  if (!ready.value) return
  history.value = null
  historyLoading.value = true
  historyError.value = ''
  return historyRead.execute(
    () => readV3<HistoryMetrics>('/dashboard/history-metrics'),
    (value) => {
      history.value = value
      historyLoading.value = false
    },
    (error) => {
      historyError.value = message(error)
      historyLoading.value = false
    }
  )
}
function loadPhases() {
  if (!ready.value) return
  phases.value = []
  phaseLoading.value = true
  return phaseRead.execute(
    async () =>
      (
        await Promise.allSettled(
          recruitingStages.map((stage) =>
            readV3<Page<Application>>(
              '/applications?applicationStatus=active&limit=1&stage=' + stage
            )
          )
        )
      ).map((value) => (value.status === 'fulfilled' ? value.value.total : null)),
    (value) => {
      phases.value = value
      phaseLoading.value = false
    },
    () => {
      phaseLoading.value = false
    }
  )
}
function loadPositions() {
  if (!ready.value) return
  const run = ++positionRun
  const session = v3Session.version()
  positionsLoading.value = true
  positionError.value = ''
  positions.value = []
  completed.value = {}
  runningCounts.clear()
  return positionRead.execute(
    async () => {
      const rows = await collectPositions(
        (start, limit) =>
          readV3<Page<Position>>('/positions?status=open&limit=' + limit + '&offset=' + start),
        () => run === positionRun && ready.value && session === v3Session.version()
      )
      return byPublishDate(
        rows.filter((row) => row.status === 'open' && row.deletedAt == null)
      ).slice(0, 3)
    },
    (rows) => {
      positions.value = rows
      positionsLoading.value = false
      void restorePosition(route.fullPath)
      for (const row of rows) void loadCompleted(row.id)
    },
    (error) => {
      positionError.value = message(error)
      positionsLoading.value = false
    }
  )
}
async function loadCompleted(id: number) {
  if (!ready.value || runningCounts.has(id) || !positions.value.some((row) => row.id === id)) return
  const request = {}
  const session = v3Session.version()
  runningCounts.set(id, request)
  delete completed.value[id]
  const current = () =>
    runningCounts.get(id) === request && session === v3Session.version() && ready.value
  try {
    const page = await readV3<Page<unknown>>(
      '/interviews?positionId=' + id + '&status=completed&limit=1&offset=0'
    )
    if (current()) completed.value[id] = page.total
  } catch {
    if (current()) completed.value[id] = null
  } finally {
    if (runningCounts.get(id) === request) runningCounts.delete(id)
  }
}
function openEditor(
  event: MouseEvent,
  row: Position | null,
  action: 'edit' | 'status' | 'archive' = 'edit',
  opener?: HTMLElement
) {
  if (!ready.value || editor.value) return
  editorFocus.remember(event, opener)
  editor.value = { row, action }
}
function closeEditor() {
  editor.value = null
  void editorFocus.restore()
}
function savedPosition() {
  closeEditor()
  void loadPositions()
  void loadSummary()
}
function reveal(id: string) {
  const target = document.getElementById(id)
  target?.focus({ preventScroll: true })
  target?.scrollIntoView({ block: 'start' })
}
function selectAndReveal(key: WorkType) {
  select(key)
  reveal('dashboard-work-details')
}
const metrics = computed(() =>
  summary.value
    ? [
        {
          key: 'positions',
          title: '开放职位',
          count: summary.value.openPositions.count,
          unit: '个职位记录'
        },
        {
          key: 'applications',
          title: '活跃申请',
          count: summary.value.activeApplications.count,
          unit: '条申请记录'
        },
        {
          key: 'scheduling',
          title: '待安排',
          count: summary.value.work.scheduling.count,
          unit: '条申请记录'
        },
        {
          key: 'offer',
          title: 'Offer 待处理',
          count: summary.value.work.offer.count,
          unit: '条申请记录'
        }
      ]
    : []
)
const message = (e: unknown) => (e instanceof Error ? e.message : '读取失败，请重试。')
function loadSummary() {
  if (!ready.value) return
  summary.value = null
  summaryError.value = ''
  summaryLoading.value = true
  return sr.execute(
    () => readV3<Summary>('/dashboard/summary'),
    (v) => {
      summary.value = v
      summaryLoading.value = false
    },
    (e) => {
      summaryError.value = message(e)
      summaryLoading.value = false
    }
  )
}
function loadWork() {
  if (!ready.value) return
  work.value = null
  workError.value = ''
  workLoading.value = true
  return wr.execute(
    () => readV3<WorkPage>(workPath(type.value, offerStatus.value, offset.value)),
    (v) => {
      work.value = v
      workLoading.value = false
    },
    (e) => {
      workError.value = message(e)
      workLoading.value = false
    }
  )
}
function loadToday() {
  if (!ready.value) return
  today.value = null
  todayError.value = ''
  todayLoading.value = true
  return tr.execute(
    () => readV3<Today>('/dashboard/today-interviews?limit=10&offset=' + todayOffset.value),
    (v) => {
      today.value = v
      todayLoading.value = false
    },
    (e) => {
      todayError.value = message(e)
      todayLoading.value = false
    }
  )
}
function select(key: WorkType) {
  type.value = key
  offerStatus.value = ''
  offset.value = 0
  void loadWork()
}
function selectOffer(key: string) {
  type.value = 'offer'
  offerStatus.value = key
  offset.value = 0
  void loadWork()
}
function changeOffer() {
  offset.value = 0
  void loadWork()
}
function page(n: number) {
  offset.value += n
  void loadWork()
}
function todayPage(n: number) {
  todayOffset.value += n
  void loadToday()
}
// Read only the existing paginated recruiting projection. One scan serves both dashboard tables.
const identityPageSize = 100
const identityPageLimit = 5
let identityRun: object | undefined

async function loadIdentities() {
  if (!ready.value || identityRun) return
  const run = {}
  identityRun = run
  identityState.value = 'loading'
  const sessionVersion = v3Session.version()
  const isCurrent = () =>
    identityRun === run && ready.value && v3Session.version() === sessionVersion
  const records = new Map<number, Identity>()
  try {
    for (let page = 0; page < identityPageLimit; page++) {
      const offset = page * identityPageSize
      const result = await readV3<Page<Application>>(
        '/applications?limit=' + identityPageSize + '&offset=' + offset
      )
      if (!isCurrent()) return
      for (const { id, name, positionId, positionTitle } of result.items) {
        records.set(id, { name, positionId, positionTitle })
      }
      if (result.items.length < identityPageSize || offset + result.items.length >= result.total)
        break
    }
    identities.value = records
    identityState.value = 'ready'
  } catch {
    if (!isCurrent()) return
    identities.value = records
    identityState.value = 'error'
  } finally {
    if (identityRun === run) identityRun = undefined
  }
}

function refreshWork() {
  void loadWork()
  void loadIdentities()
}

function refreshToday() {
  void loadToday()
  void loadIdentities()
}

function refreshAll() {
  void loadHistory()
  void loadPhases()
  void loadPositions()
  void loadIdentities()
  void loadSummary()
  void loadWork()
  void loadToday()
}
function clear() {
  historyRead.invalidate()
  phaseRead.invalidate()
  positionRead.invalidate()
  positionRun++
  runningCounts.clear()
  history.value = null
  historyError.value = ''
  historyLoading.value = false
  phases.value = []
  phaseLoading.value = false
  positions.value = []
  positionsLoading.value = false
  positionError.value = ''
  completed.value = {}
  if (v3Session.state.status === 'anonymous' || v3Session.state.status === 'forbidden')
    editor.value = null
  identityRun = undefined
  identities.value = new Map()
  identityState.value = 'loading'
  sr.invalidate()
  wr.invalidate()
  tr.invalidate()
  summary.value = null
  work.value = null
  today.value = null
  summaryLoading.value = false
  workLoading.value = false
  todayLoading.value = false
}
watch(
  [() => v3Session.state.status, () => v3Session.state.user?.id],
  () => {
    clear()
    if (ready.value) refreshAll()
  },
  { immediate: true }
)
onUnmounted(clear)
</script>
