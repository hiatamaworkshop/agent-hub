// 人宛ての本文の言語 (HUB_LANGUAGE、C66・design.md §3.5)。値は BCP 47 の言語タグ (例 ja、en、pt-BR)。
// Hub は起動時に検証し、attach の応答で shim に渡す。shim は言語の名前を明示した 1 行を instructions に差し込む

const TAG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/

// 英語での言語の名前 (ja → Japanese)。引けなければ undefined
function displayName(tag: string): string | undefined {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' }).of(tag)
  } catch {
    return undefined
  }
}

// 正規化したタグ (ja、pt-BR)。形が違う・名前を引けない言語 (zz など) は null
export function normalizeLanguage(value: string): string | null {
  const v = value.trim()
  if (!TAG.test(v)) return null
  let tag: string | undefined
  try {
    tag = Intl.getCanonicalLocales(v)[0]
  } catch {
    return null
  }
  return tag && displayName(tag.split('-')[0]!) ? tag : null
}

// 英語での言語の名前。引けなければタグのまま
export function languageName(tag: string): string {
  return displayName(tag) ?? tag
}

// instructions に差し込む 1 行。英語の role の説明とやりとりに引かれて本文が英語に流れないよう、言語の名前を明示する。
// 返事の型の見出しは UI が読む目印なので訳させない (design.md §3.15)
export function languageInstruction(tag: string): string {
  const name = languageName(tag)
  return (
    `Write everything addressed to the human user (replies, questions, reports) in ${name} (${tag}), ` +
    `even when the role description and other agents' messages are in another language. ` +
    `Keep the reply-format headings (RESULT, VERIFIED, NOT VERIFIED, NEEDS DECISION, NEEDS ACTION, CHANGED and the like) exactly as written; do not translate them.`
  )
}
