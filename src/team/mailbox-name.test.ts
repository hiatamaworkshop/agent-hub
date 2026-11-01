import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { chooseMailboxName, defaultMailboxName, mailboxNameFor } from '../shared/types.js'
import { chooseAgentMailbox } from './agent.js'
import { agentSub, chooseStartNames } from './team.js'

// C103: a start picks the default Mailbox name, or <parent>-<folder> when the default belongs to another project; a later start in the
// same folder gets the same name; an explicit --mailbox is used as given (agent's rule, passed on by team)
const MINE = 'C:\\work\\b\\app'
const OTHER = 'C:\\other\\a\\app'

describe('chooseMailboxName (C103)', () => {
  it('the default name when no Mailbox holds it', () => {
    assert.equal(chooseMailboxName(MINE, 'deployer', []), 'app.deployer')
    assert.equal(chooseMailboxName(MINE, 'deployer', [{ name: 'other.deployer', project: OTHER }]), 'app.deployer')
  })

  it('the default name when it is this project (differently written folder), so the same project keeps it', () => {
    const known = [{ name: 'app.deployer', project: 'c:/work/b/app/' }]
    assert.equal(chooseMailboxName(MINE, 'deployer', known), 'app.deployer')
  })

  it('another project holds the default: <parent>-<folder>.<role>', () => {
    const known = [{ name: 'app.deployer', project: OTHER }]
    assert.equal(chooseMailboxName(MINE, 'deployer', known), 'b-app.deployer')
  })

  it('a later start in the same folder gets the same name it took before', () => {
    const known = [
      { name: 'app.deployer', project: OTHER },
      { name: 'b-app.deployer', project: MINE },
    ]
    assert.equal(chooseMailboxName(MINE, 'deployer', known), 'b-app.deployer')
    assert.equal(chooseMailboxName(MINE, 'deployer', [...known, { name: 'b-app.leader', project: MINE }]), 'b-app.deployer', 'the other role does not change it')
  })

  it('a candidate held by a third project is skipped: <parent>-<folder>-2.<role>', () => {
    const known = [
      { name: 'app.deployer', project: OTHER },
      { name: 'b-app.deployer', project: 'C:\\x\\c\\app' },
    ]
    assert.equal(chooseMailboxName(MINE, 'deployer', known), 'b-app-2.deployer')
  })

  it('a Mailbox with no project is not another project: the default stays', () => {
    assert.equal(chooseMailboxName(MINE, 'deployer', [{ name: 'app.deployer', project: null }]), 'app.deployer')
  })

  it('without a role, the stem alone is the name', () => {
    assert.equal(chooseMailboxName(MINE, null, [{ name: 'app', project: OTHER }]), 'b-app')
  })

  it('the default name is the folder rule (unchanged for the folder names of existing Mailboxes)', () => {
    assert.equal(defaultMailboxName(MINE, 'deployer'), 'app.deployer')
    assert.equal(defaultMailboxName(MINE, null), 'app')
  })

  it('throws when every candidate belongs to other projects', () => {
    const known = [
      { name: 'app.deployer', project: OTHER },
      { name: 'b-app.deployer', project: 'C:\\x\\c\\app' },
      ...Array.from({ length: 8 }, (_, i) => ({ name: `b-app-${i + 2}.deployer`, project: `C:\\x\\${i}\\app` })),
    ]
    assert.throws(() => chooseMailboxName(MINE, 'deployer', known), /no free Mailbox name/)
  })
})

describe('the team passes its chosen name to each agent (C103)', () => {
  it('--mailbox is added when given, so the agent uses it as given', () => {
    assert.deepEqual(agentSub('deployer', MINE, undefined, 'b-app.deployer'), ['agent', '--role', 'deployer', '--project', MINE, '--from-team', '--mailbox', 'b-app.deployer'])
    assert.ok(!agentSub('deployer', MINE).includes('--mailbox'), 'without a name the agent chooses itself')
  })
})

// Long folder names: the numeric suffix must survive the cut to 64 characters (reviewer note, C103)
describe('long names keep the suffix (C103)', () => {
  const parent = 'p'.repeat(40)
  const folder = 'f'.repeat(40)
  const dir = `C:\\${parent}\\${folder}`
  const stem = `${parent}-${folder}`

  it('mailboxNameFor keeps the suffix and stays within 64 characters', () => {
    const name = mailboxNameFor(stem, 'deployer', '-2')
    assert.ok(name.endsWith('-2.deployer'), name)
    assert.ok(name.length <= 64, `${name.length} characters`)
    assert.notEqual(name, mailboxNameFor(stem, 'deployer', '-3'), 'different suffixes give different names')
  })

  it('with suffix "" the name is what it was before (cut to fit, then .role)', () => {
    assert.equal(mailboxNameFor('abc', 'deployer'), 'abc.deployer')
    assert.equal(mailboxNameFor('x'.repeat(80), 'deployer').length, 64)
  })

  it('a long default taken by another project, and the long alternative taken too, reach -2 (the old cut made them all the same)', () => {
    const alt = mailboxNameFor(stem, 'deployer')
    const known = [
      { name: mailboxNameFor(folder, 'deployer'), project: 'C:\\other\\x\\y' },
      { name: alt, project: 'C:\\other\\z\\w' },
    ]
    const chosen = chooseMailboxName(dir, 'deployer', known)
    assert.equal(chosen, mailboxNameFor(stem, 'deployer', '-2'))
    assert.ok(chosen.length <= 64)
  })

  it('all eight suffixes taken throws, and each candidate was distinct', () => {
    const known = [
      { name: mailboxNameFor(folder, 'deployer'), project: 'C:\\other\\a\\b' },
      { name: mailboxNameFor(stem, 'deployer'), project: 'C:\\other\\a\\c' },
      ...Array.from({ length: 8 }, (_, i) => ({ name: mailboxNameFor(stem, 'deployer', `-${i + 2}`), project: `C:\\other\\${i}\\d` })),
    ]
    assert.equal(new Set(known.map((m) => m.name)).size, 10, 'ten distinct names')
    assert.throws(() => chooseMailboxName(dir, 'deployer', known), /no free Mailbox name/)
  })
})

// The team's name step, run once the Hub is up (C103 review). With a token, a list that cannot be read stops the start
describe('chooseStartNames: after the Hub is up (C103)', () => {
  const dir = 'C:\\work\\b\\app'
  const otherList = [{ name: 'app.deployer', project: 'C:\\other\\a\\app', attachment: null }]

  it('chooses the other name when the Hub holds the default for another project', async () => {
    const names = await chooseStartNames(['deployer', 'leader'], dir, 'tok', async () => otherList)
    assert.equal(names.get('deployer'), 'b-app.deployer')
    assert.equal(names.get('leader'), 'app.leader')
  })

  it('with a token and an unreadable list it throws: the default name is not guessed', async () => {
    await assert.rejects(chooseStartNames(['deployer'], dir, 'tok', async () => null), /cannot be read.*nothing is started/)
  })

  it('without a token the default names are used (nothing to read)', async () => {
    const names = await chooseStartNames(['deployer'], dir, '', async () => null)
    assert.equal(names.get('deployer'), 'app.deployer')
  })
})

// `agent` on its own (C103 review): an explicit --mailbox is used as given; with a token an unreadable list fails; without one the default is used
describe('chooseAgentMailbox (C103)', () => {
  const o = { role: 'deployer', projectDir: 'C:\\work\\b\\app' }

  it('an explicit --mailbox is used as given, without reading the Hub', async () => {
    let reads = 0
    const name = await chooseAgentMailbox({ ...o, mailbox: 'mine' }, 'tok', async () => (reads++, null))
    assert.equal(name, 'mine')
    assert.equal(reads, 0)
  })

  it('with a token and an unreadable list it fails, saying to start the Hub or pass --mailbox', async () => {
    await assert.rejects(chooseAgentMailbox(o, 'tok', async () => null), /--mailbox/)
  })

  it('with a token and a readable list it chooses the name', async () => {
    const name = await chooseAgentMailbox(o, 'tok', async () => [{ name: 'app.deployer', project: 'C:\\other\\a\\app', attachment: null }])
    assert.equal(name, 'b-app.deployer')
  })

  it('without a token the default name is used, and the list is not needed', async () => {
    assert.equal(await chooseAgentMailbox(o, '', async () => null), 'app.deployer')
  })
})
