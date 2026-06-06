<template>
  <div class="setup">
    <div class="hero">
      <span class="logo" aria-hidden="true">🔍</span>
      <h1>長毛象站外搜索</h1>
      <p>搜索你自己的嘟文、轉嘟、喜歡與書籤——全部在本機建立索引，不經過第三方。</p>
    </div>

    <form class="card" @submit.prevent="save">
      <label for="acct">你的長毛象 ID</label>
      <input
        id="acct"
        type="text"
        v-model="acct"
        placeholder="merely@fsk.im"
        autocapitalize="off"
        autocomplete="off"
        spellcheck="false"
      />
      <BlockingButton class="accent submit" :click="save">開始使用</BlockingButton>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import sessions from '../functions/sessions'
import { StatusStore } from '../models/StatusStore'
import BlockingButton from './BlockingButton.vue'

const emit = defineEmits<{
  (e: 'setupComplete', store: StatusStore): void
}>()

const acct = ref('')
async function save() {
  if (!acct.value.trim()) {
    return
  }
  const store = await sessions.addSession(acct.value.trim())
  emit('setupComplete', store)
}
</script>

<style scoped>
.setup {
  max-width: 26rem;
  margin: 3rem auto 0;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}
.hero {
  text-align: center;
}
.logo {
  font-size: 2.5rem;
}
.hero h1 {
  margin: 0.5rem 0 0.4rem;
  font-size: 1.6rem;
  font-weight: 800;
}
.hero p {
  margin: 0;
  color: var(--text-muted);
  line-height: 1.6;
}
.card {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 1.25rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow);
}
.card label {
  font-weight: 600;
  font-size: 0.9rem;
}
.card input {
  padding: 0.7rem 0.85rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.card input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.card .submit {
  margin-top: 0.3rem;
}
</style>
