<template>
  <article class="v4-application-card" :class="{ 'is-closed': row.applicationStatus === 'closed' }">
    <header>
      <span class="v4-candidate-avatar" aria-hidden="true">{{
        Array.from(row.name.trim())[0] || '申'
      }}</span>
      <div class="v4-candidate-name">
        <strong :title="row.name">{{ row.name || '姓名未记录' }}</strong>
        <small>申请 #{{ row.id }}</small>
      </div>
      <span class="v4-record-badge" :data-state="row.applicationStatus">{{
        label(row.applicationStatus)
      }}</span>
    </header>
    <div class="v4-application-job-surface">
      <div class="v4-application-job" :title="row.positionTitle + ' · #' + row.positionId">
        <V4JobGlyph />
        <span>{{ row.positionTitle || '职位名称未记录' }}</span>
        <small>#{{ row.positionId }}</small>
      </div>
      <div
        v-if="row.stage === 'offer' || row.applicationStatus === 'closed'"
        class="v4-candidate-outcome"
      >
        <span v-if="row.applicationStatus === 'closed'"
          >招聘结果 · {{ applicationOutcomeText(row) }}</span
        >
        <span v-if="row.stage === 'offer'">Offer · {{ applicationOfferText(row) }}</span>
      </div>
    </div>
    <footer>
      <div class="v4-card-meta">
        <span :title="row.owner">负责人 · {{ row.owner || '—' }}</span>
        <span>{{ row.appliedDate || '—' }}</span>
      </div>
      <RouterLink
        :to="'/candidates/' + row.id"
        :data-application-link="row.id"
        :aria-label="'查看详情，申请 #' + row.id"
        @click="$emit('open', $event, row.id)"
        >查看详情 <span aria-hidden="true">→</span></RouterLink
      >
    </footer>
  </article>
</template>

<script setup lang="ts">
import {
  applicationOfferText,
  applicationOutcomeText,
  label,
  type Application
} from '../api/recruiting-v3'
import V4JobGlyph from './V4JobGlyph.vue'
defineProps<{ row: Application }>()
defineEmits<{ open: [event: MouseEvent, id: number] }>()
</script>
