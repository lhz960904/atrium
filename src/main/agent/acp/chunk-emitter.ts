import type { ContentBlock, SessionNotification } from '@agentclientprotocol/sdk';
import type { UIMessageChunk } from 'ai';

type Writer = { write: (chunk: UIMessageChunk) => void };
type Update = SessionNotification['update'];

const textOf = (c: ContentBlock): string => (c.type === 'text' ? c.text : '');

/**
 * Translate the external agent's ACP session/update notifications into the AI
 * SDK UIMessageChunk stream the client already renders. ACP streams text,
 * thoughts, and tool calls interleaved; the chunk protocol needs explicit
 * start/end around each text and reasoning block, so we track the one open
 * block and close it whenever a different kind of update arrives (or the turn
 * flushes). External tool calls carry arbitrary names, so they go out as
 * `dynamic` tool parts rather than the static, typed builtins.
 */
export class ChunkEmitter {
  private open: { kind: 'text' | 'reasoning'; id: string } | null = null;
  private counter = 0;

  constructor(private readonly writer: Writer) {}

  handle(update: Update): void {
    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        this.append('text', textOf(update.content));
        break;
      case 'agent_thought_chunk':
        this.append('reasoning', textOf(update.content));
        break;
      case 'tool_call':
        this.closeOpen();
        // providerExecuted: the external agent runs its own tools — without this
        // the client treats them as client-side tools whose results need sending
        // back, and auto-resumes the turn forever.
        this.writer.write({
          type: 'tool-input-available',
          toolCallId: update.toolCallId,
          toolName: update.kind ?? 'tool',
          input: update.rawInput ?? {},
          dynamic: true,
          providerExecuted: true,
          title: update.title,
        });
        break;
      case 'tool_call_update':
        if (update.status === 'completed' || update.status === 'failed') {
          this.writer.write({
            type: 'tool-output-available',
            toolCallId: update.toolCallId,
            output: update.rawOutput ?? { content: update.content ?? null, status: update.status },
            providerExecuted: true,
          });
        }
        break;
      // plan / available_commands_update / current_mode_update: rendered later.
    }
  }

  /** Close any open text/reasoning block — call when the turn ends. */
  flush(): void {
    this.closeOpen();
  }

  private append(kind: 'text' | 'reasoning', delta: string): void {
    if (delta === '') return;
    if (this.open && this.open.kind !== kind) this.closeOpen();
    if (!this.open) {
      this.counter += 1;
      const id = `acp-${kind}-${this.counter}`;
      this.open = { kind, id };
      this.writer.write(
        kind === 'text' ? { type: 'text-start', id } : { type: 'reasoning-start', id },
      );
    }
    const { id } = this.open;
    this.writer.write(
      kind === 'text' ? { type: 'text-delta', id, delta } : { type: 'reasoning-delta', id, delta },
    );
  }

  private closeOpen(): void {
    if (!this.open) return;
    const { kind, id } = this.open;
    this.writer.write(kind === 'text' ? { type: 'text-end', id } : { type: 'reasoning-end', id });
    this.open = null;
  }
}
