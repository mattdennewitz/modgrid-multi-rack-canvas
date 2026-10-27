import { describe, expect, it } from 'vitest';
import { createSseParser, readStreamEvent } from '../server/openrouter';

describe('createSseParser', () => {
  it('handles payloads split across chunks and ignores comments', () => {
    const parse = createSseParser();
    expect(parse(': OPENROUTER PROCESSING\n\ndata: {"a"')).toEqual([]);
    expect(parse(':1}\n\ndata: [DONE]\n')).toEqual(['{"a":1}', '[DONE]']);
  });
});

describe('readStreamEvent', () => {
  it('extracts visible text and ignores reasoning deltas', () => {
    expect(readStreamEvent({ choices: [{ delta: { content: 'Hi' } }] })).toEqual({ text: 'Hi', finish: null });
    expect(readStreamEvent({ choices: [{ delta: { reasoning: 'hmm' } }] })).toEqual({ text: '', finish: null });
  });

  it('reports the finish reason so truncation is not silent', () => {
    expect(readStreamEvent({ choices: [{ delta: {}, finish_reason: 'length' }] })).toEqual({ text: '', finish: 'length' });
  });

  it('throws on in-stream errors', () => {
    expect(() => readStreamEvent({ error: { message: 'boom' } })).toThrow('boom');
  });
});
