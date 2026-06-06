<template>
  <Suspense>
    <Main/>
    <template #fallback>
      <div class="boot">
        <span class="spinner" aria-hidden="true"></span>
        <p>正在載入…</p>
      </div>
    </template>
  </Suspense>
</template>

<script setup lang="ts">
import Main from "./components/Main.vue"
</script>

<style scoped>
.boot {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.9rem;
  padding: 5rem 1rem;
  color: var(--text-muted);
}
.spinner {
  width: 1.6rem;
  height: 1.6rem;
  border: 3px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
.boot p {
  margin: 0;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
