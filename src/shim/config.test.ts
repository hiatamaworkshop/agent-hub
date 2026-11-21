import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { envDecidesProject, loadConfig, setProject } from './config.js'

// 既定値の確認用。process.env ではない env を渡すので .env は読まれない
const base = { CLAUDE_PROJECT_DIR: join(tmpdir(), 'Some Folder') }

describe('loadConfig: 空の環境変数は未設定として扱う', () => {
  it('空や空白だけの値は既定値になる', () => {
    const cfg = loadConfig({
      ...base,
      HUB_URL: '',
      HUB_PORT: '  ',
      HUB_TOKEN: '',
      HUB_MAILBOX: '',
      HUB_ROLE: ' ',
      CLAUDE_CODE_SESSION_ID: '',
      HUB_FILES_DIR: '\t',
    })
    assert.equal(cfg.hubUrl, 'http://127.0.0.1:7777')
    assert.equal(cfg.token, '')
    assert.equal(cfg.role, null)
    assert.equal(cfg.mailbox, 'some-folder')
    assert.equal(cfg.sessionId, undefined)
    assert.equal(cfg.filesDir, join(tmpdir(), 'agent-hub'))
  })

  it('空の HUB_MAILBOX は <フォルダ名>.<role>、HUB_ROLE も空ならフォルダ名に落ちる', () => {
    assert.equal(loadConfig({ ...base, HUB_MAILBOX: '', HUB_ROLE: 'leader' }).mailbox, 'some-folder.leader')
    assert.equal(loadConfig({ ...base, HUB_MAILBOX: '', HUB_ROLE: '' }).mailbox, 'some-folder')
  })

  it('空の HUB_PROJECT / CLAUDE_PROJECT_DIR は未設定 (C180)', () => {
    const cfg = loadConfig({ HUB_PROJECT: ' ', CLAUDE_PROJECT_DIR: '' })
    assert.equal(cfg.projectSource, 'cwd')
    assert.equal(cfg.cwd, process.cwd())
  })

  it('空でない値は今までどおり使う (HUB_PORT は URL の既定にだけ効く)', () => {
    const cfg = loadConfig({ ...base, HUB_PORT: '7800', HUB_TOKEN: 'tok', HUB_MAILBOX: 'deployer', CLAUDE_CODE_SESSION_ID: 's1' })
    assert.equal(cfg.hubUrl, 'http://127.0.0.1:7800')
    assert.equal(cfg.token, 'tok')
    assert.equal(cfg.mailbox, 'deployer')
    assert.equal(cfg.sessionId, 's1')
    assert.equal(loadConfig({ ...base, HUB_URL: 'http://127.0.0.1:9000/' }).hubUrl, 'http://127.0.0.1:9000')
  })
})

// C180: the project's sources in order: HUB_PROJECT → CLAUDE_PROJECT_DIR → (roots, decided in initialize) → process.cwd()
describe('loadConfig: プロジェクトの出どころ (C180)', () => {
  const hubProject = join(tmpdir(), 'Hub Project')
  const claudeDir = join(tmpdir(), 'Claude Dir')

  it('HUB_PROJECT が先、次に CLAUDE_PROJECT_DIR。Mailbox 名は決まったプロジェクトのフォルダ名から作る', () => {
    const both = loadConfig({ HUB_PROJECT: hubProject, CLAUDE_PROJECT_DIR: claudeDir })
    assert.equal(both.projectSource, 'HUB_PROJECT')
    assert.equal(both.cwd, hubProject)
    assert.equal(both.mailbox, 'hub-project')
    const claude = loadConfig({ CLAUDE_PROJECT_DIR: claudeDir, HUB_ROLE: 'deployer' })
    assert.equal(claude.projectSource, 'CLAUDE_PROJECT_DIR')
    assert.equal(claude.cwd, claudeDir)
    assert.equal(claude.mailbox, 'claude-dir.deployer')
    assert.equal(envDecidesProject(both), true)
    assert.equal(envDecidesProject(claude), true)
  })

  it('どちらもなければ process.cwd() を仮に置き、roots を待つ (source は cwd)', () => {
    const cfg = loadConfig({})
    assert.equal(cfg.projectSource, 'cwd')
    assert.equal(cfg.cwd, process.cwd())
    assert.equal(envDecidesProject(cfg), false)
  })

  it('HUB_MAILBOX は、プロジェクトを変えても Mailbox 名を変えない', () => {
    const cfg = loadConfig({ HUB_MAILBOX: 'fixed', HUB_PROJECT: hubProject })
    assert.equal(cfg.mailbox, 'fixed')
    assert.equal(cfg.mailboxGiven, true)
    setProject(cfg, claudeDir, 'roots')
    assert.equal(cfg.cwd, claudeDir)
    assert.equal(cfg.projectSource, 'roots')
    assert.equal(cfg.mailbox, 'fixed')
  })

  it('setProject は HUB_MAILBOX がなければ Mailbox 名を新しいプロジェクトのフォルダ名から作り直す (role を含む)', () => {
    const cfg = loadConfig({ HUB_ROLE: 'reviewer' })
    assert.equal(cfg.mailboxGiven, false)
    setProject(cfg, join(tmpdir(), 'Proj A'), 'roots')
    assert.equal(cfg.cwd, join(tmpdir(), 'Proj A'))
    assert.equal(cfg.projectSource, 'roots')
    assert.equal(cfg.mailbox, 'proj-a.reviewer')
  })
})
