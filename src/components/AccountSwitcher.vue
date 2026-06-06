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

      <button type="button" class="row" role="menuitem" :disabled="busy" @click="openAdd">
        <span class="ic" aria-hidden="true">＋</span><span>新增帳號</span>
      </button>

      <button type="button" class="row danger" role="menuitem" :disabled="busy" @click="removeCurrent">
        <span class="ic" aria-hidden="true">🗑</span><span>移除此帳號</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import sessions, { storeKey } from '../functions/sessions'
import { ResolvedAccountSetting } from '../models/AccountSetting'
import { StatusStore } from '../models/StatusStore'

const props = defineProps<{
  account: ResolvedAccountSetting
}>()
// One event for every kind of change: the new active store, or undefined when
// the last account was removed. Main owns rebuilding the index from it. `add`
// asks Main to open the full Setup screen for a new account (login or browse).
const emit = defineEmits<{
  (e: 'changed', store: StatusStore | undefined): void
  (e: 'add'): void
}>()

const open = ref(false)
const known = ref<ResolvedAccountSetting[]>([])
const busy = ref(false)
const root = ref<HTMLElement | null>(null)

const keyOf = (a: ResolvedAccountSetting) => storeKey(a)
const activeKey = computed(() => storeKey(props.account))

async function toggle() {
  open.value = !open.value
  if (open.value) {
    known.value = await sessions.listSessions()
  }
}

function close() {
  open.value = false
}

// Hand the add flow off to Main, which shows the same Setup screen used on first
// run (login or no-login browse) rather than an inline form in this menu.
function openAdd() {
  close()
  emit('add')
}

async function switchTo(a: ResolvedAccountSetting) {
  const key = keyOf(a)
  if (key === activeKey.value) {
    close()
    return
  }
  busy.value = true
  try {
    await sessions.setActive(key)
    emit('changed', await sessions.loadStore(key))
    close()
  } finally {
    busy.value = false
  }
}

async function removeCurrent() {
  busy.value = true
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
  // runs, and contains() on a now-detached target wrongly reports "outside".
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
</style>
