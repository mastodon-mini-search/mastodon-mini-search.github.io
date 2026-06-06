<template>
  <div class="setup">
    <button
      v-if="cancelable"
      type="button"
      class="back"
      :disabled="!!busy"
      @click="emit('cancel')"
    >← 返回</button>

    <div class="hero">
      <span class="logo" aria-hidden="true">🔍</span>
      <h1>{{ cancelable ? '新增帳號' : '長毛象本地搜索' }}</h1>
      <p v-if="cancelable">登入或輸入另一個長毛象帳號，加入後可在右上角隨時切換。</p>
      <p v-else>搜索你自己的嘟文、轉嘟、喜歡與書籤——全部在本機建立索引，不經過第三方。</p>
    </div>

    <form class="card" @submit.prevent="login">
      <label for="acct">你的長毛象 ID 或站點</label>
      <input
        id="acct"
        type="text"
        v-model="acct"
        placeholder="merely@fsk.im"
        autocapitalize="off"
        autocomplete="off"
        spellcheck="false"
        :disabled="!!busy"
      />
      <button class="accent submit" type="submit" :disabled="!!busy">
        <span v-if="busy === 'login'" class="spinner" aria-hidden="true"></span>
        {{ busy === 'login' ? '正在前往授權…' : '用 Mastodon 登入' }}
      </button>
      <button type="button" :disabled="!!busy" @click="browse">
        <span v-if="busy === 'browse'" class="spinner" aria-hidden="true"></span>
        {{ busy === 'browse' ? '載入中…' : '不登入，只搜索公開嘟文' }}
      </button>
      <p v-if="error" class="error">{{ error }}</p>
      <p class="note">登入會跳轉到你的站點授權，之後才能搜索喜歡與書籤；不登入只能搜索你的公開嘟文。</p>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useSessions } from '../composables/useSessions'
import { beginLogin } from '../functions/oauth'

// `cancelable` is set when there's already an active account (the switcher's
// "add account" flow reuses this screen); the very first setup has no account to
// go back to, so it hides the back button and shows the welcome copy instead.
defineProps<{
  cancelable?: boolean
}>()
const emit = defineEmits<{
  (e: 'cancel'): void
}>()

// The browse path adds the account and makes it active; Main reacts to the
// active store changing (dismissing this screen, building the index).
const { addByHandle } = useSessions()

const acct = ref('')
// Which action is in flight (disables the form), or '' when idle.
const busy = ref<'' | 'login' | 'browse'>('')
const error = ref('')

// OAuth path: register on the instance and redirect to its consent screen. Main
// finishes the login when the browser returns, so there's nothing to emit. The
// button stays in its "redirecting" state until navigation; only a failure
// before the redirect (bad instance, network) lands back here with an error.
async function login() {
  const input = acct.value.trim()
  if (!input) {
    return
  }
  busy.value = 'login'
  error.value = ''
  try {
    await beginLogin(input)
  } catch {
    error.value = '無法連到這個站點，請確認站點網址是否正確'
    busy.value = ''
  }
}

// No-login path: resolve the handle and browse public toots only (no favourites
// or bookmarks). Needs a full `user@instance` handle, not a bare instance.
async function browse() {
  const input = acct.value.trim()
  if (!/^[^@\s]+@[^@\s]+$/.test(input)) {
    error.value = '請輸入「用戶名@站點」格式（例如 merely@fsk.im）'
    return
  }
  busy.value = 'browse'
  error.value = ''
  try {
    await addByHandle(input)
  } catch {
    error.value = '找不到這個帳號，請確認 ID 是否正確'
    busy.value = ''
  }
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
.back {
  align-self: flex-start;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  padding: 0.3rem 0.4rem;
  font-size: 0.9rem;
}
.back:hover:not(:disabled) {
  background: transparent;
  color: var(--text);
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
.card button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
}
.card .submit {
  margin-top: 0.3rem;
}
.note {
  margin: 0.2rem 0 0;
  font-size: 0.8rem;
  line-height: 1.5;
  color: var(--text-muted);
}
.error {
  margin: 0;
  font-size: 0.8rem;
  color: var(--danger);
}
.spinner {
  width: 0.9em;
  height: 0.9em;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  opacity: 0.8;
  animation: spin 0.7s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
