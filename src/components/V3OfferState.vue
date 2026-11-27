<template>
  <dl v-if="overview" class="v4-offer-overview">
    <div>
      <dt>Offer 状态</dt>
      <dd>{{ offerText }}</dd>
    </div>
    <div>
      <dt>申请生命周期</dt>
      <dd :data-state="state.applicationStatus">{{ label(state.applicationStatus) }}</dd>
    </div>
    <div>
      <dt>招聘结果</dt>
      <dd>{{ outcomeText }}</dd>
    </div>
  </dl>
  <dl :class="overview ? 'v4-offer-extra' : 'v3-offer-state'">
    <dt>招聘阶段</dt>
    <dd>{{ label(state.stage) }}</dd>
    <template v-if="!overview">
      <dt>申请生命周期</dt>
      <dd>{{ label(state.applicationStatus) }}</dd>
      <dt>Offer 子状态</dt>
      <dd>{{ offerText }}</dd>
      <dt>最终结果</dt>
      <dd>{{ outcomeText }}</dd>
    </template>
    <dt>结束时间（北京时间）</dt>
    <dd>
      {{
        state.closedAt === null && state.applicationStatus === 'active'
          ? '—'
          : safeHistoryTime(state.closedAt, feedbackTime)
      }}
    </dd>
    <dt>结束原因</dt>
    <dd>{{ state.closedReason ?? '—' }}</dd>
    <dt>版本</dt>
    <dd>{{ state.version }}</dd>
  </dl>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { safeHistoryTime } from '../api/history-display'
import { label } from '../api/recruiting-v3'
import { offerStatuses, outcomes, type OfferState } from '../api/offer-v3'
import { feedbackTime } from '../api/feedback-v3'
const props = defineProps<{ state: OfferState; overview?: boolean }>()
const offerText = computed(() => {
  const { offerStatus, applicationStatus, stage } = props.state
  if (!offerStatus)
    return offerStatus === null &&
      ['screening', 'first_interview', 'second_interview'].includes(stage)
      ? '未进入 Offer'
      : '未记录 Offer 状态'
  if (offerStatus === 'accepted' && applicationStatus === 'closed')
    return '已接受（Offer 最后事实）'
  return Object.hasOwn(offerStatuses, offerStatus) ? offerStatuses[offerStatus] : '未知，待核实'
})
const outcomeText = computed(() => {
  const { outcome, applicationStatus } = props.state
  if (!outcome)
    return outcome === null && applicationStatus === 'active' ? '尚未结束' : '未记录结束结果'
  return Object.hasOwn(outcomes, outcome) ? outcomes[outcome] : '未知，待核实'
})
</script>
