import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, it } from 'node:test'
import { chooseRoot, folderOfRoot, movedNote, rootFolders, withTimeout } from './project.js'

// C180: the roots part of the shim's project. The folders are built from pathToFileURL so the test runs the same on Windows and Linux
const A = join(tmpdir(), 'proj-a')
const B = join(tmpdir(), 'proj-b')
const uri = (dir: string) => ({ uri: pathToFileURL(dir).href })

describe('folderOfRoot / rootFolders', () => {
  it('a file URI gives its folder, and a URI that is not a file gives nothing', () => {
    assert.equal(folderOfRoot(uri(A)), A)
    assert.equal(folderOfRoot({ uri: 'https://example.com/x' }), undefined)
    assert.equal(folderOfRoot({ uri: 'not a uri' }), undefined)
  })

  it('a trailing separator is dropped, and whoami lists the URI for a root that is not a folder', () => {
    assert.equal(folderOfRoot({ uri: `${pathToFileURL(A).href}/` }), A)
    assert.deepEqual(rootFolders([uri(A), { uri: 'https://example.com/x' }]), [A, 'https://example.com/x'])
  })
})

describe('chooseRoot (C180: the single root decides; several are not guessed between)', () => {
  it('one local folder is the project', () => {
    assert.deepEqual(chooseRoot([uri(A)]), { dir: A })
  })

  it('several roots are not guessed between, and the reason names the count', () => {
    const c = chooseRoot([uri(A), uri(B)])
    assert.ok('reason' in c)
    assert.match(c.reason, /2 roots/)
  })

  it('no roots, and one root that is not a local folder, are not used either', () => {
    assert.ok('reason' in chooseRoot([]))
    const c = chooseRoot([{ uri: 'https://example.com/x' }])
    assert.ok('reason' in c)
    assert.match(c.reason, /not a local folder/)
  })
})

describe('movedNote (C180: a single root that differs is reported, not followed)', () => {
  it('a single root in another folder gives one line that names both folders and says to restart', () => {
    const note = movedNote(A, [uri(B)])
    assert.ok(note)
    assert.ok(!note.includes('\n'), 'one line')
    assert.ok(note.includes(A) && note.includes(B))
    assert.match(note, /restart the client/)
  })

  it('the same folder (case and separators aside), several roots, no roots and no answer give no note', () => {
    assert.equal(movedNote(A, [uri(A)]), null)
    assert.equal(movedNote(A + sep, [uri(A)]), null, 'a trailing separator on the attached folder is the same folder')
    assert.equal(movedNote(A, [uri(A), uri(B)]), null)
    assert.equal(movedNote(A, []), null)
    assert.equal(movedNote(A, null), null)
    assert.equal(movedNote(A, [{ uri: 'https://example.com/x' }]), null)
  })
})

describe('withTimeout', () => {
  it('passes the value through, and rejects with the name of what did not answer', async () => {
    assert.equal(await withTimeout(Promise.resolve(3), 1000, 'roots/list'), 3)
    await assert.rejects(withTimeout(new Promise(() => undefined), 20, 'roots/list'), /roots\/list did not answer within 20ms/)
  })
})
