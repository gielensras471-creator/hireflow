<template>
  <div class="v3-table-scroll">
    <table>
      <thead>
        <tr>
          <th>申请 / 职位</th>
          <th>阶段 / 状态</th>
          <th>业务提示</th>
          <th>业务时间（上海）</th>
          <th>操作</th>
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
        >
          <td>
            申请 #{{ row.applicationId }}<small>职位 #{{ row.positionId }}</small
            ><small v-if="row.interviewId">面试 #{{ row.interviewId }}</small>
          </td>
          <td>
            {{ label(row.stage)
            }}<small>{{
              row.interviewStatus
                ? interviewStatus[row.interviewStatus]
                : label(row.applicationStatus)
            }}</small>
          </td>
          <td>{{ row.hint ?? '—' }}</td>
          <td>
            {{ feedbackTime(today ? row.scheduledAt! : row.businessTime!)
            }}<small>{{
              today ? '预约开始时间' : timeKinds[row.businessTimeKind ?? ''] ?? '服务端业务时间'
            }}</small>
          </td>
          <td>
            <RouterLink :to="'/candidates/' + row.applicationId"
              >查看申请 #{{ row.applicationId }}</RouterLink
            >
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
<script setup lang="ts">
import { label } from '../api/recruiting-v3'
import { feedbackTime } from '../api/feedback-v3'
import { interviewStatus } from '../api/interview-v3'
import { timeKinds, type WorkRow } from '../api/dashboard-v3'
defineProps<{ items: WorkRow[]; loading: boolean; today?: boolean }>()
</script>
