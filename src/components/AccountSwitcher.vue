<template>
  <div class="switcher" ref="root">
    <button
      class="trigger"
      type="button"
      aria-haspopup="menu"
      :aria-expanded="open"
      @click="toggle"
    >
      <span class="acct">@{{ account.acct }}</span>
      <span class="chev" :class="{ up: open }" aria-hidden="true">▾</span>
    </button>

    <div v-if="open" class="menu" role="menu">
      <p class="label">帳號</p>
      <button
        v-for="a in known"
        :key="keyOf(a)"
        type="button"
        class="row"
        :class="{ active: keyOf(a) === activeKey }"
        role="menuitemradio"
        :aria-checked="keyOf(a) === activeKey"
        :disabled="busy"
        @click="switchTo(a)"
      >
        <span class="check" aria-hidden="true">{{ keyOf(a) === activeKey ? '✓' : '' }}</span>
        <span class="acct">@{{ a.acct }}</span>
      </button>

      <hr />

      <form v-if="adding" class="add" @submit.prevent="loginAdd">
        <input
          ref="addInput"
          v-model="newAcct"
          placeholder="user@instance.tld"
          autocapitalize="off"
          autocomplete="off"
          spellcheck="false"
          :disabled="busy"
        />
        <div class="add-actions">
          <button class="accent" type="submit" :disabled="busy">
            <span v-if="addBusy === 'login'" class="spinner" aria-hidden="true"></span>登入
          </button>
          <button type="button" :disabled="busy" @click="browseAdd">
            <span v-if="addBusy === 'browse'" class="spinner" aria-hidden="true"></span>免登入
          </button>
        </div>
      </form>
      <button v-else type="button" class="row" role="menuitem" :disabled="busy" @click="startAdd">
        <span class="ic" aria-hidden="true">＋</span><span>新增帳號</span>
      </button>
      <p v-if="error" class="error">{{ error }}</p>

      <button type="button" class="row danger" role="menuitem" :disabled="busy" @click="removeCurrent">
        <span class="ic" aria-hidden="true">🗑</span><span>移除此帳號</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import sessions, { storeKey } from '../functions/sessions'
import { ResolvedAccountSetting } from '../models/AccountSetting'
import { StatusStore } from '../models/StatusStore'
import { beginLogin } from '../functions/oauth'

const props = defineProps<{
  account: ResolvedAccountSetting
}>()
// One event for every kind of change: the new active store, or undefined when
// the last account was removed. Main owns rebuilding the index from it.
const emit = defineEmits<{
  (e: 'changed', store: StatusStore | undefined): void
}>()

const open = ref(false)
const known = ref<ResolvedAccountSetting[]>([])
const adding = ref(false)
const newAcct = ref('')
const busy = ref(false)
// Which add-action is in flight, to show the right inline spinner ('' = none).
const addBusy = ref<'' | 'login' | 'browse'>('')
const error = ref('')
const root = ref<HTMLElement | null>(null)
const addInput = ref<HTMLInputElement | null>(null)

const keyOf = (a: ResolvedAccountSetting) => storeKey(a)
const activeKey = computed(() => storeKey(props.account))

async function toggle() {
  open.value = !open.value
  if (open.value) {
    adding.value = false
    error.value = ''
    known.value = await sessions.listSessions()
  }
}

function close() {
  open.value = false
  adding.value = false
  newAcct.value = ''
  error.value = ''
  addBusy.value = ''
}

async function startAdd() {
  adding.value = true
  error.value = ''
  await nextTick()
  addInput.value?.focus()
}

async function switchTo(a: ResolvedAccountSetting) {
  const key = keyOf(a)
  if (key === activeKey.value) {
    close()
    return
  }
  busy.value = true
  error.value = ''
  try {
    await sessions.setActive(key)
    emit('changed', await sessions.loadStore(key))
    close()
  } finally {
    busy.value = false
  }
}

// OAuth path: redirect to the instance's consent screen. The page navigates
// away; Main finishes the login and activates the account when it returns, so
// there's no 'changed' emit here. Accepts a bare instance or a full handle.
async function loginAdd() {
  const input = newAcct.value.trim()
  if (!input) {
    return
  }
  busy.value = true
  addBusy.value = 'login'
  error.value = ''
  try {
    await beginLogin(input)
  } catch {
    error.value = '無法連到這個站點，請確認站點網址是否正確'
    busy.value = false
    addBusy.value = ''
  }
}

// No-login path: resolve the handle and add it for public-toot browsing only
// (no favourites/bookmarks). Needs a full `user@instance` handle.
async function browseAdd() {
  const input = newAcct.value.trim()
  if (!/^[^@\s]+@[^@\s]+$/.test(input)) {
    error.value = '請輸入「用戶名@站點」格式'
    return
  }
  busy.value = true
  addBusy.value = 'browse'
  error.value = ''
  try {
    emit('changed', await sessions.addSession(input))
    close()
  } catch {
    error.value = '找不到這個帳號，請確認 ID 是否正確'
  } finally {
    busy.value = false
    addBusy.value = ''
  }
}

async function removeCurrent() {
  busy.value = true
  error.value = ''
  try {
    await sessions.removeSession(activeKey.value)
    // Falls back to the first remaining account, or undefined when none are left.
    emit('changed', await sessions.loadActiveStore())
    close()
  } finally {
    busy.value = false
  }
}

function onDocClick(e: MouseEvent) {
  if (!open.value || !root.value) {
    return
  }
  // Use composedPath() rather than contains(e.target): clicking a menu item can
  // re-render and detach the clicked element before this bubble-phase listener
  // runs (e.g. "新增帳號" swaps itself for the add form), and contains() on a
  // now-detached target wrongly reports "outside" and closes the menu.
  if (!e.composedPath().includes(root.value)) {
    close()
  }
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    close()
  }
}
onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKey)
})
</script>

<style scoped>
.switcher {
  position: relative;
}
.trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  max-width: 14rem;
  padding: 0.35rem 0.6rem;
  font-size: 0.85rem;
  font-weight: 600;
}
.trigger .acct {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chev {
  color: var(--text-muted);
  transition: transform 0.15s ease;
}
.chev.up {
  transform: rotate(180deg);
}

.menu {
  position: absolute;
  top: calc(100% + 0.4rem);
  right: 0;
  z-index: 20;
  min-width: 15rem;
  padding: 0.35rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
}
.label {
  margin: 0.25rem 0.5rem;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  text-align: left;
  border: 0;
  background: transparent;
  border-radius: 6px;
  padding: 0.5rem 0.55rem;
  font-size: 0.9rem;
  font-weight: 500;
}
.row:hover:not(:disabled) {
  background: var(--surface-hover);
}
.row.active {
  color: var(--accent);
  font-weight: 700;
}
.row .acct {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.check {
  width: 1rem;
  flex: none;
  color: var(--accent);
}
.ic {
  width: 1rem;
  flex: none;
  text-align: center;
  color: var(--text-muted);
}
.row.danger {
  color: var(--danger);
}
.row.danger .ic {
  color: var(--danger);
}
.row.danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
}
hr {
  border: 0;
  border-top: 1px solid var(--border);
  margin: 0.35rem 0;
}
.add {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.25rem 0.3rem;
}
.add input {
  min-width: 0;
  padding: 0.45rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  outline: none;
}
.add input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.add-actions {
  display: flex;
  gap: 0.4rem;
}
.add-actions button {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  padding: 0.45rem 0.7rem;
  font-size: 0.85rem;
}
.spinner {
  width: 0.85em;
  height: 0.85em;
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
.error {
  margin: 0.15rem 0.55rem 0.35rem;
  font-size: 0.8rem;
  color: var(--danger);
}
</style>
