// `git-hook`: put a thin post-commit hook in a project that sends the ledger index after a commit that changed it (C52, C107).
// The hook only calls agent-hub's tools/hooks/post-commit-index.sh, so a change to that script reaches every project without copying.
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'

const MARKER = '# agent-hub post-commit index hook'
// A full copy of the script, the way usage.md said to install it before this command
const COPIED = 'AGENT_HUB_DIR="${AGENT_HUB_DIR:-}"'

export function postCommitHook(root: string): string {
  const dir = root.replace(/\\/g, '/')
  return [
    '#!/bin/sh',
    `${MARKER} (written by \`npm run team -- git-hook --write\`).`,
    '# Sends the ledger index to the Hub after a commit that changed it. The logic is agent-hub\'s script, so its updates apply here.',
    `AGENT_HUB_DIR="${dir}"`,
    'export AGENT_HUB_DIR',
    '[ -f "$AGENT_HUB_DIR/tools/hooks/post-commit-index.sh" ] || exit 0',
    'exec sh "$AGENT_HUB_DIR/tools/hooks/post-commit-index.sh"',
    '',
  ].join('\n')
}

export type GitHookState =
  | { kind: 'no-git'; reason: string }
  | { kind: 'missing' | 'set' | 'stale' | 'copied' | 'other'; path: string }

// Where git runs post-commit for this project (`git rev-parse --git-path`, so worktrees and core.hooksPath are followed), and what is there
export function gitHookState(projectDir: string, root: string): GitHookState {
  const r = spawnSync('git', ['rev-parse', '--git-path', 'hooks/post-commit'], { cwd: projectDir, encoding: 'utf8' })
  if (r.status !== 0) return { kind: 'no-git', reason: (r.stderr || r.error?.message || 'git rev-parse failed').trim() }
  const out = r.stdout.trim()
  const path = isAbsolute(out) ? out : join(projectDir, out)
  if (!existsSync(path)) return { kind: 'missing', path }
  const text = readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
  if (text === postCommitHook(root)) return { kind: 'set', path }
  if (text.includes(MARKER)) return { kind: 'stale', path }
  if (text.includes(COPIED) && text.includes('docs:index')) return { kind: 'copied', path }
  return { kind: 'other', path }
}

// Prints what is there; with write, writes the thin hook when the file is missing, an older thin hook, or a copied script
// (a copy gets a .bak beside it). A post-commit of the project's own is never touched: the line to add is printed instead
export function runGitHook(projectDir: string, root: string, write: boolean): number {
  const st = gitHookState(projectDir, root)
  if (st.kind === 'no-git') { console.error(`${projectDir} is not a git repository: ${st.reason}`); return 1 }
  if (st.kind === 'set') { console.log(`The post-commit index hook is set: ${st.path}`); return 0 }
  const runLine = `AGENT_HUB_DIR="${root.replace(/\\/g, '/')}" sh "${root.replace(/\\/g, '/')}/tools/hooks/post-commit-index.sh"`
  if (st.kind === 'other') {
    console.warn(`WARNING: ${st.path} is the project's own hook, so it is not changed. To send the index too, add this line to it:\n  ${runLine}`)
    return 1
  }
  const what = { missing: 'no post-commit hook', stale: 'an older agent-hub hook', copied: 'a copied post-commit-index.sh' }[st.kind]
  if (!write) {
    console.log(`${st.path}: ${what}. Run again with --write to write the post-commit index hook`)
    return 1
  }
  try {
    mkdirSync(dirname(st.path), { recursive: true })
    let backup = ''
    if (st.kind === 'copied') { copyFileSync(st.path, `${st.path}.bak`); backup = ` (the copy is kept as ${st.path}.bak)` }
    writeFileSync(st.path, postCommitHook(root))
    chmodSync(st.path, 0o755)
    console.log(`Wrote the post-commit index hook: ${st.path}${backup}`)
    return 0
  } catch (e) {
    console.error(`Could not write ${st.path}: ${e instanceof Error ? e.message : String(e)}`)
    return 1
  }
}
