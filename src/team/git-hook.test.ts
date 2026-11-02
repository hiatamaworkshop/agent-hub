import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { gitHookState, postCommitHook, runGitHook } from './git-hook.js'

// The post-commit index hook is written by one command and only calls agent-hub's script (2026-11-02, cairn)
const ROOT = 'C:\\tools\\agent-hub'
const dirs: string[] = []
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }) })

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agent-hub-git-hook-'))
  dirs.push(dir)
  spawnSync('git', ['init', '-q'], { cwd: dir })
  return dir
}
const hookPath = (dir: string) => join(dir, '.git', 'hooks', 'post-commit')

test('postCommitHook: names agent-hub with / separators and runs its script', () => {
  const text = postCommitHook(ROOT)
  assert.ok(text.startsWith('#!/bin/sh\n'))
  assert.ok(text.includes('AGENT_HUB_DIR="C:/tools/agent-hub"'))
  assert.ok(text.includes('exec sh "$AGENT_HUB_DIR/tools/hooks/post-commit-index.sh"'))
})

test('runGitHook: without --write nothing is written; with it the hook is written, and a second run finds it set', () => {
  const dir = repo()
  assert.equal(gitHookState(dir, ROOT).kind, 'missing')
  assert.equal(runGitHook(dir, ROOT, false), 1)
  assert.equal(existsSync(hookPath(dir)), false)
  assert.equal(runGitHook(dir, ROOT, true), 0)
  assert.equal(readFileSync(hookPath(dir), 'utf8'), postCommitHook(ROOT))
  assert.equal(gitHookState(dir, ROOT).kind, 'set')
  assert.equal(runGitHook(dir, ROOT, true), 0)
})

test('runGitHook: a hook written for another agent-hub folder is rewritten', () => {
  const dir = repo()
  writeFileSync(hookPath(dir), postCommitHook('D:\\old\\agent-hub'))
  assert.equal(gitHookState(dir, ROOT).kind, 'stale')
  assert.equal(runGitHook(dir, ROOT, true), 0)
  assert.equal(gitHookState(dir, ROOT).kind, 'set')
})

test('runGitHook: a copied post-commit-index.sh is replaced, with a .bak', () => {
  const dir = repo()
  const copy = readFileSync(new URL('../../tools/hooks/post-commit-index.sh', import.meta.url), 'utf8')
  writeFileSync(hookPath(dir), copy)
  assert.equal(gitHookState(dir, ROOT).kind, 'copied')
  assert.equal(runGitHook(dir, ROOT, true), 0)
  assert.equal(readFileSync(`${hookPath(dir)}.bak`, 'utf8'), copy)
  assert.equal(gitHookState(dir, ROOT).kind, 'set')
})

test("runGitHook: the project's own post-commit is not touched", () => {
  const dir = repo()
  writeFileSync(hookPath(dir), '#!/bin/sh\necho mine\n')
  assert.equal(gitHookState(dir, ROOT).kind, 'other')
  assert.equal(runGitHook(dir, ROOT, true), 1)
  assert.equal(readFileSync(hookPath(dir), 'utf8'), '#!/bin/sh\necho mine\n')
})

test('runGitHook: a folder that is not a git repository says so', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-hub-no-git-'))
  dirs.push(dir)
  assert.equal(gitHookState(dir, ROOT).kind, 'no-git')
  assert.equal(runGitHook(dir, ROOT, true), 1)
})
