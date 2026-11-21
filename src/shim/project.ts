// C180: the shim's project from the client's roots (MCP roots/list). The environment sources (HUB_PROJECT, CLAUDE_PROJECT_DIR) and
// the setProject that applies a choice are in config.ts. The shim asks for roots during initialize, only when the environment names
// no folder and the client declares roots, and attaches with the answer (design.md §3.3, §3.7). Later changes are reported, not followed.
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeProjectPath } from '../shared/types.js'

export interface Root {
  uri: string
}

// The local folder a root names, or undefined for a URI that is not a file (or does not parse)
export function folderOfRoot(root: Root): string | undefined {
  try {
    const u = new URL(root.uri)
    return u.protocol === 'file:' ? resolve(fileURLToPath(u)) : undefined
  } catch {
    return undefined
  }
}

// What whoami shows for the client's roots: the folder where it is one, the URI otherwise
export function rootFolders(roots: readonly Root[]): string[] {
  return roots.map((r) => folderOfRoot(r) ?? r.uri)
}

// The one root of the client, when there is exactly one and it is a local folder. Several roots are not guessed between,
// so the caller uses the next source and says why (the reason names the count)
export function chooseRoot(roots: readonly Root[]): { dir: string } | { reason: string } {
  if (roots.length === 0) return { reason: 'roots/list returned no roots' }
  if (roots.length > 1) return { reason: `roots/list returned ${roots.length} roots, and one is needed to pick the project` }
  const dir = folderOfRoot(roots[0]!)
  return dir ? { dir } : { reason: `the one root (${roots[0]!.uri}) is not a local folder` }
}

// The one-line note for a single root that differs from the attached folder (C180). The shim does not move; the human restarts the client.
// null when there is no such root (none, several, not a folder, or the same folder as the attached one)
export function movedNote(attached: string, roots: readonly Root[] | null): string | null {
  if (!roots || roots.length !== 1) return null
  const dir = folderOfRoot(roots[0]!)
  if (!dir || normalizeProjectPath(dir) === normalizeProjectPath(attached)) return null
  return `This session stays on ${attached}, but the client now reports ${dir} as its folder. The shim does not move; restart the client to move this session to ${dir}.`
}

// Rejects when ms pass first. The promise itself is not cancelled
export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not answer within ${ms}ms`)), ms)
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
}
