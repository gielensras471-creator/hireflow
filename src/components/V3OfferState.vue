<template>
  <dl class="v3-offer-state">
    <dt>招聘阶段</dt>
    <dd>{{ label(state.stage) }}</dd>
    <dt>申请生命周期</dt>
    <dd>{{ label(state.applicationStatus) }}</dd>
    <dt>Offer 子状态</dt>
    <dd>
      {{
        state.offerStatus
          ? state.offerStatus === 'accepted' && state.applicationStatus === 'closed'
            ? '已接受（Offer 最后事实）'
            : Object.hasOwn(offerStatuses, state.offerStatus)
              ? offerStatuses[state.offerStatus]
              : '未知，待核实'
          : state.offerStatus === null &&
              ['screening', 'first_interview', 'second_interview'].includes(state.stage)
            ? '未进入 Offer'
            : '未记录 Offer 状态'
      }}
    </dd>
    <dt>最终结果</dt>
    <dd>
      {{
        state.outcome
          ? Object.hasOwn(outcomes, state.outcome)
            ? outcomes[state.outcome]
            : '未知，待核实'
          : state.outcome === null && state.applicationStatus === 'active'
            ? '尚未结束'
            : '未记录结束结果'
      }}
    </dd>
    <dt>结束时间（上海）</dt>
    <dd>{{ state.closedAt === null ? '—' : feedbackTime(state.closedAt) }}</dd>
    <dt>结束原因</dt>
    <dd>{{ state.closedReason ?? '—' }}</dd>
    <dt>版本</dt>
    <dd>{{ state.version }}</dd>
  </dl>
</template>
<script setup lang="ts">
import { label } from '../api/recruiting-v3'
import { offerStatuses, outcomes, type OfferState } from '../api/offer-v3'
import { feedbackTime } from '../api/feedback-v3'
defineProps<{ state: OfferState }>()
</script>
