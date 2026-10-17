// roles.json の読み込みと検証 (protocol.md §2 Role 定義)。Hub は起動時に 1 度だけ読む
import { readFileSync } from 'node:fs'
import { isValidName } from '../shared/types.js'

export interface RoleDef {
  description: string
  subscribe: string[]
  // 未知の項目も読み捨てずに持つ (後でメッセージの形の宣言を足せるように。今は使わない)
  [key: string]: unknown
}

export type Roles = ReadonlyMap<string, RoleDef>

// 起動を止める理由。メッセージにはファイル名と問題の場所を入れる
export class RolesError extends Error {}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// ファイルがなければ null (P0 と同じ動き: role 名は検証せず、既定購読も説明もなし)。
// あって読めない・形が違うときは RolesError (黙って既定に戻さない)
export function loadRoles(file: string): Roles | null {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new RolesError(`${file} を読めない: ${(e as Error).message}`)
  }
  return parseRoles(text, file)
}

export function parseRoles(text: string, file = 'roles.json'): Roles {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    throw new RolesError(`${file} が JSON として読めない: ${(e as Error).message}`)
  }
  if (!isPlainObject(raw)) throw new RolesError(`${file} は role 名をキーにしたオブジェクトであること`)

  const roles = new Map<string, RoleDef>()
  for (const [name, def] of Object.entries(raw)) {
    const where = `${file} の role "${name}"`
    if (!isValidName(name)) throw new RolesError(`${where}: role 名は ^[a-z0-9][a-z0-9_.-]{0,63}$ に合うこと`)
    if (!isPlainObject(def)) throw new RolesError(`${where}: オブジェクトであること`)
    if (typeof def.description !== 'string') throw new RolesError(`${where}: description は文字列であること`)
    if (!Array.isArray(def.subscribe)) throw new RolesError(`${where}: subscribe はトピック名の配列であること`)
    for (const topic of def.subscribe) {
      if (typeof topic !== 'string' || !isValidName(topic)) {
        throw new RolesError(`${where}: subscribe の ${JSON.stringify(topic)} はトピック名 (^[a-z0-9][a-z0-9_.-]{0,63}$) に合わない`)
      }
    }
    roles.set(name, { ...def, description: def.description, subscribe: def.subscribe as string[] })
  }
  return roles
}
