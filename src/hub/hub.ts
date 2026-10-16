// Hub の振る舞い (配信・購読・Attachment)。HTTP から独立させ、app.ts は入出力の変換だけにする
import type { Attachment, Message, PostMessageInput, Sender } from '../shared/types.js'
import type { Store } from './store.js'

export class HubError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

// UI 向け SSE の 1 件 (protocol.md §7)
export interface UiEvent {
  event: string
  data: unknown
}

export class Hub {
  private readonly uiListeners = new Set<(e: UiEvent) => void>()
  readonly attachments = new Map<string, Attachment>()

  constructor(readonly store: Store) {}

  onUi(fn: (e: UiEvent) => void): () => void {
    this.uiListeners.add(fn)
    return () => this.uiListeners.delete(fn)
  }

  private emitUi(event: string, data: unknown): void {
    for (const fn of this.uiListeners) fn({ event, data })
  }

  // X-Hub-Attachment の Attachment から送り手を決める。from はリクエストから受け取らない
  senderOf(attachmentId: string): Sender {
    const at = this.attachments.get(attachmentId)
    if (!at) throw new HubError(404, 'attachment_not_found', `attachment ${attachmentId} がない`)
    return { type: 'mailbox', id: at.mailbox, role: this.store.getMailbox(at.mailbox)?.role ?? null }
  }

  postMessage(input: PostMessageInput, from: Sender): Message {
    if (input.replyTo !== undefined && !this.store.getMessage(input.replyTo)) {
      throw new HubError(400, 'reply_to_not_found', `replyTo ${input.replyTo} がない`)
    }
    const m = this.store.appendMessage({ ...input, from })
    this.emitUi('message', m)
    return m
  }
}
