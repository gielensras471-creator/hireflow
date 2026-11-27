<template>
  <span class="v4-job-glyph" aria-hidden="true">
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linejoin="round"
    >
      <rect x="3" y="7" width="18" height="14" rx="3" />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18m-11 0v2h4v-2" />
    </svg>
  </span>
</template>

<style scoped>
.v4-job-glyph {
  display: inline-grid;
  place-items: center;
  flex: none;
  inline-size: 24px;
  block-size: 24px;
  border: 1px solid #a678d7;
  border-radius: 7px;
  background: linear-gradient(135deg, #7134c7, #c399ed);
  color: white;
}
svg {
  inline-size: 14px;
  block-size: 14px;
}
</style>
