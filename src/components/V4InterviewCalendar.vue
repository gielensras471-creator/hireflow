<template>
  <section class="v4-week v3-card" :data-mode="mode" aria-label="北京时间面试日历">
    <header class="v4-week-header">
      <div class="v4-calendar-title">
        <span class="v4-calendar-glyph" aria-hidden="true"
          ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
            <rect x="4" y="6" width="16" height="14" rx="2" />
            <path d="M8 3v5m8-5v5M4 11h16" /></svg
        ></span>
        <div>
          <h2>{{ title }}</h2>
          <small
            >北京时间 · {{ mode === 'month' ? '自然月' : mode === 'week' ? '周一至周日' : '自然日' }}</small
          >
        </div>
      </div>
      <div class="v4-interview-switch" role="group" aria-label="时间视图">
        <button
          v-for="(name, key) in modes"
          :key="key"
          :aria-pressed="mode === key"
          type="button"
          @click="$emit('mode', key)"
        >
          {{ name }}
        </button>
      </div>
      <div class="v4-week-nav">
        <el-button :aria-label="'上一' + stepLabel" @click="$emit('navigate', -1)">‹</el-button>
        <el-button :aria-label="'下一' + stepLabel" @click="$emit('navigate', 1)">›</el-button>
        <el-button @click="$emit('navigate', 0)">{{ resetLabel }}</el-button>
      </div>
    </header>
    <div
      v-if="mode === 'month'"
      class="v4-month-scroll"
      role="region"
      aria-label="自然月日历"
      tabindex="0"
    >
      <div class="v4-month-head">
        <span v-for="dayLabel in '一二三四五六日'" :key="dayLabel">周{{ dayLabel }}</span>
      </div>
      <div class="v4-month-grid">
        <section
          v-for="(date, index) in dates"
          :key="date"
          class="v4-month-day"
          :class="{ spillover: date.slice(0, 7) !== month, today: date === today }"
        >
          <button
            class="v4-month-date"
            type="button"
            :aria-label="date + ' 日视图'"
            :aria-current="date === today ? 'date' : undefined"
            @click="$emit('day', start + index * dayMs)"
          >
            {{ Number(date.slice(-2)) }}
          </button>
          <button
            v-for="row in monthRows[index].slice(0, 2)"
            :key="row.id"
            type="button"
            class="v4-month-event"
            :data-status="eventTone(row)"
            :data-interview-id="row.id"
            :aria-description="eventDescription(row)"
            @click="$emit('select', [row], $event)"
          >
            <strong>{{ timeLabel([row]) }}</strong> <span>{{ row.candidateName }}</span>
          </button>
          <button
            v-if="monthRows[index].length > 2"
            type="button"
            class="v4-month-more"
            @click="$emit('select', monthRows[index], $event)"
          >
            {{ complete ? '' : '已读取 · ' }}另有 {{ monthRows[index].length - 2 }} 场
          </button>
        </section>
      </div>
    </div>
    <div
      v-else
      ref="viewport"
      class="v4-week-scroll"
      role="region"
      aria-label="全天时间网格"
      tabindex="0"
    >
      <div class="v4-week-head">
        <div>北京时间<small>UTC+8</small></div>
        <div
          v-for="date in dates"
          :key="date"
          :class="{
            today: date === today,
            weekend: mode === 'week' && ['六', '日'].includes(weekday(date))
          }"
        >
          <small>周{{ weekday(date) }}</small>
          <strong>{{ date.slice(5).replace('-', '/') }}</strong>
          <small v-if="date === today">今天</small>
        </div>
      </div>
      <div
        class="v4-week-grid"
        :style="{
          '--hour': calendarHourHeight + 'px',
          '--event': calendarCardHeight + 'px',
          '--stack-offset': calendarStackOffset + 'px'
        }"
      >
        <div class="v4-week-hours">
          <div v-for="hour in 24" :key="hour">{{ String(hour - 1).padStart(2, '0') }}:00</div>
          <div>次日 00:00</div>
        </div>
        <div
          v-for="(groups, index) in days"
          :key="dates[index]"
          class="v4-week-day"
          :class="{ today: dates[index] === today }"
        >
          <div
            v-for="group in groups"
            :key="group.rows[0].id"
            class="v4-week-slot"
            :style="{ top: group.top + 'px' }"
          >
            <span v-if="group.rows.length > 1" class="v4-week-stack" aria-hidden="true" />
            <button
              type="button"
              class="v4-week-event"
              :data-status="group.rows.length > 1 ? 'group' : eventTone(group.rows[0])"
              :data-interview-id="group.rows[0].id"
              :aria-expanded="
                group.rows.length > 1 ? group.rows[0].id === selectedEventId : undefined
              "
              @click="$emit('select', group.rows, $event)"
            >
              <template v-if="group.rows.length > 1">
                <strong>{{ timeLabel(group.rows) }}</strong>
                <small>{{ complete ? '' : '已读取 ' }}{{ group.rows.length }} 场面试</small>
                <span class="v4-week-layer" aria-hidden="true"
                  ><img :src="layerIcon" alt=""
                /></span>
              </template>
              <template v-else>
                <span class="v4-week-event-line">
                  <time>{{ timeLabel(group.rows) }}</time>
                  <strong>{{ group.rows[0].candidateName }}</strong>
                  <span v-if="eventTone(group.rows[0]) === 'due'" class="v4-week-due"
                    >到时待确认</span
                  >
                </span>
                <span class="v4-week-event-line">
                  <small>{{ group.rows[0].positionTitle }}</small>
                  <small
                    >{{ label(group.rows[0].stageScope) }} ·
                    {{ interviewStatus[group.rows[0].status] }}</small
                  >
                </span>
              </template>
            </button>
          </div>
        </div>
      </div>
    </div>
    <footer class="v4-week-footer">
      <span v-for="(name, status) in interviewStatus" :key="status" :data-status="status">{{
        name
      }}</span>
      <span data-status="due">到时待确认</span>
      <small>北京时间 · 按预约开始时间定位 · 到时仅提醒</small>
      <button v-if="mode !== 'month'" type="button" @click="positionAtEight">定位 08:00</button>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { interviewStatus, type Interview } from '../api/interview-v3'
import { label } from '../api/recruiting-v3'
import layerIcon from '../assets/interview-calendar-layer.svg'
import {
  calendarCardHeight,
  calendarHourHeight,
  calendarStackOffset,
  dayMs,
  shanghaiDay,
  weekGroups,
  type CalendarMode
} from '../api/v4-interview-week'

const props = defineProps<{
  start: number
  end: number
  anchor: number
  mode: CalendarMode
  rows: Interview[]
  complete: boolean
  selectedEventId?: number
}>()
defineEmits<{
  navigate: [direction: number]
  mode: [mode: CalendarMode]
  day: [day: number]
  select: [rows: Interview[], event: MouseEvent]
}>()
const viewport = ref<HTMLElement>()
const modes = { day: '日', week: '周', month: '月' }
const stepLabel = computed(() => ({ day: '天', week: '周', month: '月' })[props.mode])
const resetLabel = computed(
  () => ({ day: '回到今天', week: '回到本周', month: '回到本月' })[props.mode]
)
const dates = computed(() =>
  Array.from({ length: (props.end - props.start) / dayMs }, (_, index) =>
    shanghaiDay(props.start + index * dayMs)
  )
)
const today = computed(() => shanghaiDay(Date.now()))
const month = computed(() => shanghaiDay(props.anchor).slice(0, 7))
const title = computed(() =>
  props.mode === 'month'
    ? month.value.replace('-', '年') + '月'
    : props.mode === 'day'
      ? dates.value[0].replaceAll('-', '.')
      : dates.value[0].replaceAll('-', '.') +
        ' – ' +
        dates.value[6]
          .slice(dates.value[0].slice(0, 4) === dates.value[6].slice(0, 4) ? 5 : 0)
          .replaceAll('-', '.')
)
const days = computed(() => weekGroups(props.rows, props.start, dates.value.length))
const monthRows = computed(() => {
  const rows: Interview[][] = dates.value.map(() => [])
  for (const row of props.rows) rows[Math.floor((row.scheduledAt - props.start) / dayMs)]?.push(row)
  return rows
})
function weekday(date: string) {
  return '日一二三四五六'[new Date(date + 'T00:00:00Z').getUTCDay()]
}
function positionAtEight() {
  if (viewport.value) viewport.value.scrollTop = 8 * calendarHourHeight
}
onMounted(positionAtEight)
watch(() => [props.start, props.mode], positionAtEight, { flush: 'post' })
function timeLabel(rows: Interview[]) {
  return (
    rows[0].scheduledLocal.slice(11, 16) +
    (rows.some((row) => row.scheduledAt !== rows[0].scheduledAt) ? ' 附近' : '')
  )
}
function eventDescription(row: Interview) {
  return [
    row.positionTitle,
    label(row.stageScope),
    eventTone(row) === 'due' ? '到时待确认' : interviewStatus[row.status]
  ].join('，')
}
function eventTone(row: Interview) {
  return row.status === 'scheduled' && row.startTimeReached ? 'due' : row.status
}
</script>
