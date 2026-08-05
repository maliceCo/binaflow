import { describe, expect, it } from 'vitest';
import { sanitizeInkText } from '../src/tui-ink/text.js';

describe('Ink text safety', () => {
  it('removes terminal control sequences and non-printable characters', () => {
    expect(sanitizeInkText('safe\u001b[31m red\u001b[0m\u0007\u001b]title\u0007')).toBe('safe red');
  });
});
