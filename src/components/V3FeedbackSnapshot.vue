<template>
  <dl class="v3-feedback-snapshot">
    <dt>专业评价人</dt>
    <dd>{{ value.reviewerName }}</dd>
    <dt>推荐意见</dt>
    <dd>
      <span class="v3-feedback-badge" :data-recommendation="value.recommendation">{{
        recommendations[value.recommendation]
      }}</span>
    </dd>
    <dt>推荐依据</dt>
    <dd class="v3-feedback-reason">{{ value.reason }}</dd>
    <dt>最初录入 HR</dt>
    <dd>账号 #{{ value.recordedByUserId }}</dd>
    <dt>原始提交时间</dt>
    <dd>{{ safeHistoryTime(value.submittedAt, feedbackTime) }}</dd>
    <dt>评价 / 修订版本</dt>
    <dd>#{{ value.id }} / {{ value.revision }}</dd>
  </dl>
</template>
<script setup lang="ts">
import { safeHistoryTime } from '../api/history-display'
import { feedbackTime, recommendations, type FeedbackSnapshot } from '../api/feedback-v3'
defineProps<{ value: FeedbackSnapshot }>()
</script>
