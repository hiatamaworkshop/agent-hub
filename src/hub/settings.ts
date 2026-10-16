// カスタムコマンドの設定 (<HUB_DATA_DIR>/settings.json)。読みは毎回ファイルから行い、書きは直列化して一時ファイル経由で置き換える
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export const COMMAND_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/
export const MAX_COMMANDS = 100
export const MAX_TEXT = 8000

export interface Command {
  name: string
  text: string
}

export interface Settings {
  version: 1
  commands: Command[]
}

// HTTP にそのまま返せる失敗。code と status は app.ts の onError で使う
export class SettingsError extends Error {
  constructor(
    readonly status: 400 | 500,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

// 形式の検証。違反は最初の 1 件を英語の message にする (UI がそのまま表示する)
export function validateCommands(input: unknown): Command[] {
  if (!Array.isArray(input)) throw new SettingsError(400, 'invalid_request', 'commands must be an array')
  if (input.length > MAX_COMMANDS) throw new SettingsError(400, 'invalid_request', `commands must have at most ${MAX_COMMANDS} items`)
  const names = new Set<string>()
  return input.map((c: unknown, i) => {
    if (typeof c !== 'object' || c === null || Array.isArray(c)) {
      throw new SettingsError(400, 'invalid_request', `commands[${i}] must be an object`)
    }
    for (const key of Object.keys(c)) {
      if (key !== 'name' && key !== 'text') throw new SettingsError(400, 'invalid_request', `unknown key "${key}" in commands[${i}]`)
    }
    const { name, text } = c as Record<string, unknown>
    if (typeof name !== 'string' || !COMMAND_NAME_RE.test(name)) {
      throw new SettingsError(400, 'invalid_request', `commands[${i}].name must be 1 to 32 characters of lowercase letters, digits, "_" or "-", starting with a letter or digit`)
    }
    if (names.has(name)) throw new SettingsError(400, 'invalid_request', `duplicate command name "${name}"`)
    names.add(name)
    if (typeof text !== 'string' || text.length < 1 || text.length > MAX_TEXT) {
      throw new SettingsError(400, 'invalid_request', `text of "${name}" must be 1 to ${MAX_TEXT} characters`)
    }
    return { name, text }
  })
}

// PUT の本文。commands 以外のキーは受け付けない
export function validateBody(body: unknown): Command[] {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new SettingsError(400, 'invalid_request', 'request body must be a JSON object with "commands"')
  }
  for (const key of Object.keys(body)) {
    if (key !== 'commands') throw new SettingsError(400, 'invalid_request', `unknown key "${key}" in the request body`)
  }
  if (!('commands' in body)) throw new SettingsError(400, 'invalid_request', '"commands" is required')
  return validateCommands((body as { commands: unknown }).commands)
}

// ファイルの中身を読む。壊れていれば理由だけを返す (中身はエラーに含めない)
function parseFile(raw: string): { commands: Command[]; extra: Record<string, unknown> } {
  const invalid = (reason: string) => new SettingsError(500, 'settings_invalid', `settings file is invalid: ${reason}`)
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    throw invalid('not valid JSON')
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) throw invalid('the top level must be an object')
  const { version, commands, ...extra } = obj as Record<string, unknown>
  if (version !== undefined && version !== 1) throw invalid('version must be 1')
  if (commands === undefined) throw invalid('"commands" is missing')
  try {
    return { commands: validateCommands(commands), extra }
  } catch (e) {
    throw invalid((e as Error).message)
  }
}

export class SettingsStore {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(readonly file: string) {}

  // 毎回読む。ファイルがなければ空の設定
  async read(): Promise<Settings> {
    const raw = await this.readRaw()
    if (raw === undefined) return { version: 1, commands: [] }
    return { version: 1, commands: parseFile(raw).commands }
  }

  // 検証してから保存する。壊れたファイルは .bak に退避してから新しく書く
  write(body: unknown): Promise<Settings> {
    const commands = validateBody(body)
    const run = this.queue.then(() => this.save(commands))
    this.queue = run.catch(() => {})
    return run
  }

  private async save(commands: Command[]): Promise<Settings> {
    const raw = await this.readRaw()
    let extra: Record<string, unknown> = {}
    if (raw !== undefined) {
      try {
        extra = parseFile(raw).extra
      } catch {
        // 手編集の内容を黙って消さない
        await copyFile(this.file, `${this.file}.bak`)
      }
    }
    const next = { version: 1, commands, ...extra }
    await mkdir(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`
    try {
      await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
      // Windows では rename が他プロセスの読み取りで失敗しうる。失敗は 500 として返す
      await rename(tmp, this.file)
    } catch (e) {
      await rm(tmp, { force: true }).catch(() => {})
      throw new SettingsError(500, 'settings_write_failed', `could not save settings: ${(e as Error).message}`)
    }
    return { version: 1, commands }
  }

  private async readRaw(): Promise<string | undefined> {
    try {
      return await readFile(this.file, 'utf8')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw e
    }
  }
}
