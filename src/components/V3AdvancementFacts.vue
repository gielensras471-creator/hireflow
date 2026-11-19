<template>
  <div class="v3-advance-facts">
    <p>
      实际来源：{{ label(facts.fromStage) }} → 合法下一阶段：{{
        facts.toStage ? label(facts.toStage) : '无'
      }}
      · 申请版本 {{ facts.version }}
    </p>
    <p v-if="facts.blockedReason" class="v3-advance-warning" role="status">
      {{ advanceBlocks[facts.blockedReason] ?? '当前状态不允许晋级，请刷新查看。' }}
    </p>
    <p v-else-if="facts.reasonType === 'missing_feedback'" class="v3-advance-warning">
      带缺评说明推进，不代表评价已齐全。缺评面试：{{
        facts.missingInterviewIds.map((id) => '#' + id).join('、')
      }}
    </p>
    <p v-else-if="facts.reasonType === 'skip_evaluation'" class="v3-advance-warning">
      本轮尚无已完成面试，需要填写跳过评估理由。
    </p>
    <p v-else>服务器当前判定可正常晋级；必须由 HR 明确确认。</p>
    <p>
      当前轮次：{{ facts.scheduled.length }} 场预约 · {{ facts.completedCount }} 场完成 ·
      {{ facts.cancelled.length }} 场取消
    </p>
    <ul v-if="facts.scheduled.length">
      <li v-for="row in facts.scheduled" :key="row.interviewId">
        待处理预约 #{{ row.interviewId }} · {{ feedbackTime(row.scheduledAt) }}
      </li>
    </ul>
    <ul v-if="facts.completed.length">
      <li v-for="row in facts.completed" :key="row.interviewId">
        已完成面试 #{{ row.interviewId }} ·
        {{
          row.feedbackId
            ? '面评 #' +
              row.feedbackId +
              ' · ' +
              recommendations[row.recommendation as Recommendation]
            : '尚无面评'
        }}
        <p v-if="feedback.find((f) => f.interviewId === row.interviewId)">
          专业评价人：{{ feedback.find((f) => f.interviewId === row.interviewId)!.reviewerName }} ·
          依据：{{ feedback.find((f) => f.interviewId === row.interviewId)!.reason }}
        </p>
      </li>
    </ul>
  </div>
</template>
<script setup lang="ts">
import { label } from '../api/recruiting-v3'
import { advanceBlocks, type Preflight } from '../api/advancement-v3'
import {
  feedbackTime,
  recommendations,
  type Recommendation,
  type FeedbackRecord
} from '../api/feedback-v3'
defineProps<{ facts: Preflight; feedback: FeedbackRecord[] }>()
</script>
