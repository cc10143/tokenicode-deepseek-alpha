import { describe, expect, it } from 'vitest';
import { parseSessionMessages } from '../session-loader';

describe('session history loading', () => {
  it('drops replayed JSONL records with the same source UUID', () => {
    const user = {
      type: 'user',
      uuid: 'user-1',
      timestamp: 1,
      message: { content: [{ type: 'text', text: 'hello' }] },
    };
    const assistant = {
      type: 'assistant',
      uuid: 'assistant-1',
      timestamp: 2,
      message: { content: [{ type: 'text', text: 'world' }] },
    };
    const loaded = parseSessionMessages([user, assistant, user, assistant]);
    expect(loaded.messages.map((message) => message.content)).toEqual(['hello', 'world']);
  });

  it('uses streaming-compatible ids for assistant text/thinking (raw content index)', () => {
    const assistant = {
      type: 'assistant',
      uuid: 'asst-uuid-1',
      timestamp: 2,
      message: {
        content: [
          { type: 'thinking', thinking: 'let me think' },
          { type: 'text', text: 'first text' },
          { type: 'tool_use', id: 'toolu_01', name: 'Bash', input: { command: 'ls' } },
          { type: 'text', text: 'second text' },
        ],
      },
    };
    const loaded = parseSessionMessages([assistant]);
    const texts = loaded.messages.filter((m) => m.type === 'text');
    const thinkings = loaded.messages.filter((m) => m.type === 'thinking');

    // Must match useStreamProcessor: id = `${uuid}_${kind}_${rawContentIndex}`.
    // tool_use occupies index 2 and produces no text/thinking message, so the
    // second text block must be _3 (raw index), not _1 (running count).
    expect(texts.map((m) => m.id)).toEqual(['asst-uuid-1_text_1', 'asst-uuid-1_text_3']);
    expect(thinkings.map((m) => m.id)).toEqual(['asst-uuid-1_thinking_0']);
  });
});
