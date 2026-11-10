// hub.config.json の読み込みと検証 (protocol.md §3 GET /config、design.md §3.8)。Hub は起動時に 1 度だけ読み、書かない。
// roles.json と違い、壊れていても止まらない: 値ごとに既定へ戻し、起動ログと UI の警告で名前を挙げる
import { readFileSync } from 'node:fs'

export interface HubConfig {
  projects: {
    // Projects のうち、これより古いものを older として分ける日数 (C73)
    olderDays: number
  }
}

export const DEFAULT_CONFIG: HubConfig = { projects: { olderDays: 30 } }

export interface ConfigResult {
  config: HubConfig
  // 既定に戻した値・無視した項目の説明。UI の警告にも出る
  warnings: string[]
  // 読んだファイル。なかった・読めなかったときは null
  file: string | null
}

export const defaultConfig = (): ConfigResult => ({ config: structuredClone(DEFAULT_CONFIG), warnings: [], file: null })

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// 項目の定義: 型と範囲の検証。通ったら値、通らなければ理由
const SCHEMA = {
  projects: {
    olderDays: (v: unknown): number | string =>
      typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 3650 ? v : 'an integer from 1 to 3650',
  },
} as const

export function parseConfig(text: string, file = 'hub.config.json'): ConfigResult {
  const out = defaultConfig()
  out.file = file
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    out.warnings.push(`${file} is not valid JSON. Everything runs on the defaults: ${(e as Error).message}`)
    return out
  }
  if (!isPlainObject(raw)) {
    out.warnings.push(`${file} must be an object. Everything runs on the defaults`)
    return out
  }
  for (const [section, body] of Object.entries(raw)) {
    const defs = (SCHEMA as Record<string, Record<string, (v: unknown) => number | string>>)[section]
    if (!Object.hasOwn(SCHEMA, section) || !defs) {
      out.warnings.push(`${file}: unknown item "${section}" was ignored`)
      continue
    }
    if (!isPlainObject(body)) {
      out.warnings.push(`${file}: "${section}" must be an object. The defaults are used`)
      continue
    }
    for (const [key, value] of Object.entries(body)) {
      const check = Object.hasOwn(defs, key) ? defs[key] : undefined
      if (!check) {
        out.warnings.push(`${file}: unknown item "${section}.${key}" was ignored`)
        continue
      }
      const r = check(value)
      if (typeof r === 'string') out.warnings.push(`${file}: "${section}.${key}" must be ${r}. The default (${(DEFAULT_CONFIG as unknown as Record<string, Record<string, unknown>>)[section]![key]}) is used`)
      else (out.config as unknown as Record<string, Record<string, unknown>>)[section]![key] = r
    }
  }
  return out
}

// ファイルがない・読めないときは、すべて既定 (起動は止めない)。読めなかった理由は warnings に入れる。ないだけなら警告ではなくログの 1 行
export function loadConfig(file: string): ConfigResult {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (e) {
    const out = defaultConfig()
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') out.warnings.push(`${file} cannot be read. Everything runs on the defaults: ${(e as Error).message}`)
    return out
  }
  return parseConfig(text, file)
}
