import { ulid } from 'ulid'

// m_ (Message), at_ (Attachment), e_ (Event)。ULID なので文字列順が時系列順になる
export function newId(prefix: 'm' | 'at' | 'e'): string {
  return `${prefix}_${ulid()}`
}
