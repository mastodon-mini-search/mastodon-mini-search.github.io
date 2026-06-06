import { createApp, type App } from 'vue'

// Run a composable inside a real (headless) component instance so lifecycle
// hooks like onBeforeUnmount actually register — and fire on unmount(). A bare
// call would warn and never tear down. Returns the composable's result plus an
// unmount() that triggers teardown; unmountAll() (call it from afterEach) cleans
// up any instance a test left mounted, cancelling its pending timers.
const mounted = new Set<App>()

export function withSetup<T>(composable: () => T): [T, () => void] {
  let result!: T
  const app = createApp({
    setup() {
      result = composable()
      return () => null
    },
  })
  app.mount(document.createElement('div'))
  mounted.add(app)
  return [result, () => { if (mounted.delete(app)) app.unmount() }]
}

export function unmountAll(): void {
  for (const app of mounted) app.unmount()
  mounted.clear()
}
