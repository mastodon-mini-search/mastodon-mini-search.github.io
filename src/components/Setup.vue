<template>
  <p>歡迎使用長毛象站外搜索工具。</p>
  <p>請在此處輸入你的長毛象ID：</p>
  <div>
    <input type="input" v-model="acct" placeholder="merely@fsk.im">
  </div>
  <div>
    <BlockingButton :click="save">保存</BlockingButton>
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
  const store = await sessions.addSession(acct.value)
  emit('setupComplete', store)
}
</script>

<style scoped>

</style>