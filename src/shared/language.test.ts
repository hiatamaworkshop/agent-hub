import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Hub } from '../hub/hub.js'
import { Store } from '../hub/store.js'
import { languageName, normalizeLanguage } from './language.js'

describe('HUB_LANGUAGE の値 (C66)', () => {
  it('BCP 47 のタグを正規化し、英語の名前を引く', () => {
    assert.equal(normalizeLanguage('ja'), 'ja')
    assert.equal(normalizeLanguage(' JA '), 'ja')
    assert.equal(normalizeLanguage('pt-br'), 'pt-BR')
    assert.equal(languageName('ja'), 'Japanese')
    assert.equal(languageName('pt-BR'), 'Brazilian Portuguese')
  })

  it('タグの形でない値と、名前を引けない言語は読めない (Hub は起動を止める)', () => {
    for (const v of ['', 'japanese', 'ja_JP', '日本語', 'zz', 'xx-YY']) assert.equal(normalizeLanguage(v), null, v)
  })

  it('Hub は attach の応答で言語を返す。設定がなければ null', () => {
    assert.equal(new Hub(new Store({}), { language: 'ja' }).attach('a', { client: 'claude-code' }).language, 'ja')
    assert.equal(new Hub(new Store({})).attach('a', { client: 'claude-code' }).language, null)
  })
})
