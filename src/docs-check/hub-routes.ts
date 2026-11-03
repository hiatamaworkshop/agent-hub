// The Hub's HTTP routes, read from the app itself (roadmap C9). Every optional store is passed so /settings, /files and /indexes are
// registered too; the stores are never called while routes are only registered, so empty stand-ins are enough.
import { createApp } from '../hub/app.js'
import type { FileStore } from '../hub/files.js'
import { Hub } from '../hub/hub.js'
import type { IndexStore } from '../hub/indexes.js'
import type { SettingsStore } from '../hub/settings.js'
import { Store } from '../hub/store.js'
import type { Route } from './repo.js'

export function hubRoutes(): Route[] {
  const app = createApp({
    hub: new Hub(new Store()),
    token: 'docs-check',
    uiHtml: async () => null,
    settings: {} as SettingsStore,
    files: {} as FileStore,
    indexes: {} as IndexStore,
  })
  const seen = new Set<string>()
  const routes: Route[] = []
  for (const { method, path } of app.routes) {
    const key = `${method} ${path}`
    if (seen.has(key)) continue
    seen.add(key)
    routes.push({ method, path })
  }
  return routes
}
