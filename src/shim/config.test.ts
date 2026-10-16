import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { loadConfig } from './config.js'

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

  it('空の HUB_MAILBOX は HUB_ROLE、その空も無ければフォルダ名に落ちる', () => {
    assert.equal(loadConfig({ ...base, HUB_MAILBOX: '', HUB_ROLE: 'leader' }).mailbox, 'leader')
    assert.equal(loadConfig({ ...base, HUB_MAILBOX: '', HUB_ROLE: '' }).mailbox, 'some-folder')
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
