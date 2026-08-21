export function sanitizeInkText(value: string): string {
  const escape = String.fromCharCode(27);
  const bell = String.fromCharCode(7);
  const withoutSequences = value
    .replace(new RegExp(`${escape}\\][^${bell}]*(?:${bell}|${escape}\\\\)`, 'g'), '')
    .replace(new RegExp(`${escape}\\[[0-?]*[ -/]*[@-~]`, 'g'), '');
  return Array.from(withoutSequences)
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return (code === 10 || code >= 32) && code !== 127 && (code < 128 || code > 159);
    })
    .join('');
}
