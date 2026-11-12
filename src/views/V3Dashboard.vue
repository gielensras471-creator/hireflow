<template>
  <section class="v3-dashboard">
    <header class="v3-dashboard-heading">
      <div>
        <h1>招聘工作台</h1>
        <p>掌握招聘进展，及时跟进关键事项</p>
      </div>
      <div>
        <RouterLink to="/candidates">管理申请 →</RouterLink
        ><el-button :disabled="!ready" @click="refreshAll">刷新工作台</el-button>
      </div>
    </header>
    <section v-if="summaryLoading" class="v3-dashboard-metrics" aria-busy="true">
      <article v-for="n in 4" :key="n" class="v3-card">
        <span class="v3-dashboard-skeleton" />
        <p role="status">读取指标中…</p>
      </article>
    </section>
    <V3Feedback
      v-else-if="summaryError"
      state="error"
      title="暂时无法查看工作台指标"
      :message="summaryError"
      action="重试指标"
      @action="loadSummary"
    />
    <template v-else-if="summary">
      <div class="v3-dashboard-metrics">
        <article v-for="m in metrics" :key="m.title" class="v3-card">
          <h2>{{ m.title }}</h2>
          <strong :data-metric="m.key">{{ m.count }}</strong
          ><small>{{ m.unit }}</small>
        </article>
      </div>
      <p class="v3-dashboard-note">
        开放职位含 {{ summary.openPositions.softDeletedOpen }} 个已归档、状态仍为开放
        的记录，不等于可投递职位。申请数为职位申请记录，不是去重人数。指标读取时间：{{
          feedbackTime(summary.now)
        }}。
      </p>
      <section class="v3-card">
        <h2>需要处理的工作</h2>
        <div class="v3-dashboard-work">
          <button
            v-for="key in primary"
            :key="key"
            :data-work="key"
            :aria-pressed="type === key"
            :class="{ 'is-selected': type === key }"
            @click="select(key)"
          >
            <span v-if="type === key" class="v3-work-selection">✓ 已选中</span
            ><span>{{ workLabels[key] }}</span
            ><strong>{{ summary.work[key].count }}</strong
            ><small>{{ unitLabel(summary.work[key].unit) }}</small>
          </button>
        </div>
        <div class="v3-dashboard-secondary">
          <button
            v-for="key in secondary"
            :key="key"
            :data-work="key"
            :aria-pressed="type === key"
            :class="{ 'is-selected': type === key }"
            @click="select(key)"
          >
            <span v-if="type === key" class="v3-work-selection">✓ 已选中</span
            >{{ workLabels[key] }} · {{ summary.work[key].count }}
            {{ unitLabel(summary.work[key].unit) }}
          </button>
        </div>
        <p class="v3-dashboard-note">
          各类别独立计量，申请级和面试级待办不合计为人数。到时仅提醒，不自动确认完成。
        </p>
      </section>
    </template>
    <section class="v3-card v3-dashboard-details" :aria-busy="workLoading">
      <header>
        <h2>待处理事项 · {{ workLabels[type] }}</h2>
        <el-button :disabled="!ready" @click="loadWork">刷新待办</el-button>
      </header>
      <label
        >待办类别<select
          :value="type"
          aria-label="待办类别"
          @change="select(($event.target as HTMLSelectElement).value as WorkType)"
        >
          <option v-for="(text, key) in workLabels" :key="key" :value="key">{{ text }}</option>
        </select></label
      >
      <label v-if="type === 'offer'"
        >Offer 子状态<select v-model="offerStatus" aria-label="Offer 子状态" @change="changeOffer">
          <option value="">全部活跃 Offer</option>
          <option v-for="(text, key) in offerLabels" :key="key" :value="key">{{ text }}</option>
        </select></label
      >
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
        @action="loadWork"
      />
      <V3Feedback
        v-else-if="!work?.items.length"
        state="empty"
        title="当前页暂无待办"
        :message="work?.total ? '可返回前一页查看。' : '当前类别没有需要处理的记录。'"
      />
      <V3DashboardTable v-else :items="work.items" :loading="false" />
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
          <el-button :disabled="!ready" @click="loadToday">刷新今日面试</el-button>
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
          @action="loadToday"
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
          /><V3DashboardTable v-else :items="today.items" :loading="false" today />
          <div class="v3-dashboard-pager">
            <el-button :disabled="todayOffset === 0" @click="todayPage(-10)">上一页面试</el-button
            ><el-button :disabled="todayOffset + 10 >= today.total" @click="todayPage(10)"
              >下一页面试</el-button
            >
          </div></template
        >
      </section>
      <section class="v3-card v3-dashboard-stats">
        <h2>辅助统计</h2>
        <p>当前快照分布；暂无趋势或阶段分布接口，不推算漏斗。</p>
        <template v-if="summary"
          ><h3>申请记录分布 · 总量 {{ summary.applicationTotals.total }} 条</h3>
          <div
            v-for="(text, key) in { active: '进行中', closed: '已结束', hired: '其中已确认录用' }"
            :key="key"
            class="v3-dashboard-bar"
          >
            <span>{{ text }}</span
            ><meter
              :value="summary.applicationTotals[key]"
              :max="Math.max(summary.applicationTotals.total, 1)"
              :aria-label="text"
            /><b>{{ summary.applicationTotals[key] }} 条</b>
          </div>
          <h3>活跃 Offer 分布</h3>
          <button
            v-for="(text, key) in offerLabels"
            :key="key"
            class="v3-dashboard-offer"
            @click="selectOffer(key)"
          >
            {{ text }} · {{ summary.offerByStatus[key] }} 条申请
          </button>
          <h3>待办分类</h3>
          <p v-for="(text, key) in workLabels" :key="key">
            {{ text }}：{{ summary.work[key].count }} {{ unitLabel(summary.work[key].unit) }}
          </p></template
        >
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
  type WorkPage,
  type Today
} from '../api/dashboard-v3'
import { feedbackTime } from '../api/feedback-v3'
import V3Feedback from '../components/V3Feedback.vue'
import V3DashboardTable from '../components/V3DashboardTable.vue'
import '../styles/v3-dashboard.scss'
const ready = computed(() => v3Session.state.status === 'ready')
const summary = ref<Summary | null>(null),
  work = ref<WorkPage | null>(null),
  today = ref<Today | null>(null)
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
const primary: WorkType[] = ['screening', 'scheduling', 'feedback', 'offer'],
  secondary: WorkType[] = ['due', 'decision']
const metrics = computed(() =>
  summary.value
    ? [
        {
          key: 'positions',
          title: '开放职位记录',
          count: summary.value.openPositions.count,
          unit: '个职位记录'
        },
        {
          key: 'applications',
          title: '活跃申请记录',
          count: summary.value.activeApplications.count,
          unit: '条申请记录'
        },
        {
          key: 'interviews',
          title: '今日面试场次',
          count: summary.value.todayInterviews.count,
          unit: '场面试'
        },
        {
          key: 'hired',
          title: '已确认录用记录',
          count: summary.value.applicationTotals.hired,
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
function refreshAll() {
  void loadSummary()
  void loadWork()
  void loadToday()
}
function clear() {
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
