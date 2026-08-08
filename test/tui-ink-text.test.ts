import { describe, expect, it } from 'vitest';
import { sanitizeInkText } from '../src/tui-ink/text.js';

describe('Ink text safety', () => {
  it('removes terminal control sequences and non-printable characters from dynamic fields', () => {
    const payload = 'safe\u001b[31m red\u001b[0m\u0007\u001b]title\u0007';
    expect(sanitizeInkText(payload)).toBe('safe red');
    expect(sanitizeInkText(`objective:${payload}`)).toBe('objective:safe red');
    expect(sanitizeInkText(`run-id\u001b[0m`)).toBe('run-id');
    expect(sanitizeInkText(`model\u0007name`)).toBe('modelname');
    expect(sanitizeInkText(`error:\u001b[31mboom\u001b[0m`)).toBe('error:boom');
    expect(sanitizeInkText(`artifact\u001b]0;x\u0007 body`)).toBe('artifact body');
  });
});
