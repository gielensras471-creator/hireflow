<template>
  <V3TableScroll :name="today ? '今日面试表格' : '招聘待办表格'">
    <table class="v3-dashboard-table" :aria-label="today ? '今日面试' : '招聘待办'">
      <colgroup>
        <col class="v3-dashboard-identity-col" />
        <col class="v3-dashboard-stage-col" />
        <col />
        <col class="v3-dashboard-time-col" />
        <col class="v3-dashboard-action-col" />
      </colgroup>
      <thead>
        <tr>
          <th scope="col">候选人 / 应聘职位</th>
          <th scope="col">{{ today ? '轮次 / 状态' : '阶段 / 状态' }}</th>
          <th scope="col">业务提示</th>
          <th scope="col">业务时间（上海）</th>
          <th scope="col" class="v3-dashboard-action">操作</th>
        </tr>
      </thead>
      <tbody v-if="loading" aria-hidden="true">
        <tr v-for="n in 4" :key="n">
          <td v-for="c in 5" :key="c"><span class="v3-dashboard-skeleton" /></td>
        </tr>
      </tbody>
      <tbody v-else>
        <tr
          v-for="row in items"
          :key="row.interviewId ?? row.applicationId"
          :data-application="row.applicationId"
          :data-interview="row.interviewId ?? undefined"
        >
          <td>
            <strong class="v3-record-primary">{{ candidateText(row) }}</strong>
            <span class="v3-record-position">{{ positionText(row) }}</span>
            <small class="v3-record-ids">
              <span>申请 #{{ row.applicationId }}</span>
              <span>职位 #{{ row.positionId }}</span>
              <span v-if="row.interviewId">面试 #{{ row.interviewId }}</span>
            </small>
          </td>
          <td>
            {{ label(row.stageScope ?? row.stage) }}
            <small>{{
              row.interviewStatus
                ? interviewStatus[row.interviewStatus]
                : label(row.offerStatus ?? row.applicationStatus)
            }}</small>
          </td>
          <td>{{ row.hint ?? '—' }}</td>
          <td>
            {{ feedbackTime(today ? row.scheduledAt! : row.businessTime!) }}
            <small>{{
              today ? '预约开始时间' : timeKinds[row.businessTimeKind ?? ''] ?? '服务端业务时间'
            }}</small>
          </td>
          <td class="v3-dashboard-action">
            <RouterLink v-slot="{ href, navigate }" :to="'/candidates/' + row.applicationId" custom>
              <el-button
                tag="a"
                size="small"
                type="primary"
                text
                bg
                :href="href"
                :aria-label="'查看申请 #' + row.applicationId"
                @click="navigate"
                >查看申请</el-button
              >
            </RouterLink>
          </td>
        </tr>
      </tbody>
    </table>
  </V3TableScroll>
</template>

<script setup lang="ts">
import V3TableScroll from './V3TableScroll.vue'
import { label, type Application } from '../api/recruiting-v3'
import { feedbackTime } from '../api/feedback-v3'
import { interviewStatus } from '../api/interview-v3'
import { timeKinds, type WorkRow } from '../api/dashboard-v3'

const props = defineProps<{
  items: WorkRow[]
  loading: boolean
  today?: boolean
  identities?: ReadonlyMap<number, Pick<Application, 'name' | 'positionId' | 'positionTitle'>>
  identityState?: 'loading' | 'ready' | 'error'
}>()

const recordedText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

function candidateText(row: WorkRow) {
  const identity = props.identities?.get(row.applicationId)
  if (identity) return recordedText(identity.name) || '候选人姓名未记录'
  if (props.identityState === 'loading') return '正在读取候选人…'
  return props.identityState === 'error' ? '候选人信息暂不可用' : '候选人信息未查到'
}

function positionText(row: WorkRow) {
  const identity = props.identities?.get(row.applicationId)
  if (identity) {
    return identity.positionId === row.positionId
      ? recordedText(identity.positionTitle) || '职位名称未记录'
      : '职位关联待核实'
  }
  if (props.identityState === 'loading') return '正在读取应聘职位…'
  return props.identityState === 'error' ? '职位信息暂不可用' : '职位信息未查到'
}
</script>
