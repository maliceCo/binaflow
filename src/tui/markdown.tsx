import { lexer } from 'marked';
import { Box } from 'ink';
import type { ReactNode } from 'react';
import { SafeText } from './components.js';
import { sanitizeInkText } from './text.js';

export function MarkdownView({
  source,
  colors,
  partial = false,
}: {
  source: string;
  colors: boolean;
  partial?: boolean;
}): ReactNode {
  if (partial) {
    return (
      <Box flexDirection="column">
        <SafeText dimColor>Partial Markdown source</SafeText>
        <SafeText>{source}</SafeText>
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      {renderBlocks(
        lexer(source, { gfm: true, breaks: true }) as unknown as Record<string, unknown>[],
        colors,
      )}
    </Box>
  );
}

function renderBlocks(tokens: readonly Record<string, unknown>[], colors: boolean): ReactNode[] {
  return tokens.flatMap((token, index) => {
    const rendered = renderBlock(token, colors, index);
    return rendered === null ? [] : [rendered];
  });
}

function renderBlock(
  token: Record<string, unknown>,
  colors: boolean,
  index: number,
): ReactNode | null {
  const type = stringValue(token.type);
  const raw = stringValue(token.raw);
  if (type === 'space' || type === 'html') return null;
  if (type === 'heading') {
    return (
      <SafeText key={`${type}-${index}`} bold {...(colors ? { color: 'cyan' as const } : {})}>
        {inlineText(token.tokens, token.text)}
      </SafeText>
    );
  }
  if (type === 'paragraph' || type === 'text') {
    return (
      <SafeText key={`${type}-${index}`}>{inlineText(token.tokens, token.text ?? raw)}</SafeText>
    );
  }
  if (type === 'blockquote') {
    return (
      <Box key={`${type}-${index}`} flexDirection="column" paddingLeft={1}>
        <SafeText dimColor>{renderInlineText(token.tokens, token.text ?? raw)}</SafeText>
      </Box>
    );
  }
  if (type === 'list') {
    const items = arrayValue(token.items);
    return (
      <Box key={`${type}-${index}`} flexDirection="column">
        {items.map((item, itemIndex) => (
          <SafeText key={`${type}-${index}-${itemIndex}`}>
            {`${token.ordered ? `${itemIndex + 1}.` : '-'} ${renderInlineText(item.tokens, item.text ?? '')}`}
          </SafeText>
        ))}
      </Box>
    );
  }
  if (type === 'code') {
    return (
      <Box key={`${type}-${index}`} flexDirection="column" paddingLeft={1}>
        <SafeText dimColor>{stringValue(token.lang) || 'code'}</SafeText>
        <SafeText>{stringValue(token.text)}</SafeText>
      </Box>
    );
  }
  if (type === 'hr')
    return (
      <SafeText key={`${type}-${index}`} dimColor>
        {'---'}
      </SafeText>
    );
  return raw ? <SafeText key={`${type}-${index}`}>{raw}</SafeText> : null;
}

function inlineText(tokens: unknown, fallback: unknown): string {
  return sanitizeInkText(renderInlineText(tokens, fallback));
}

function renderInlineText(tokens: unknown, fallback: unknown): string {
  if (!Array.isArray(tokens)) return stringValue(fallback);
  return tokens
    .map((token) => {
      if (!isRecord(token)) return '';
      const type = stringValue(token.type);
      if (type === 'link') {
        return `${renderInlineText(token.tokens, token.text)} (${stringValue(token.href)})`;
      }
      if (type === 'image') return `[image: ${stringValue(token.text)}]`;
      if (type === 'codespan') return `\`${stringValue(token.text)}\``;
      if (type === 'br') return '\n';
      if (type === 'html') return '';
      return renderInlineText(token.tokens, token.text ?? token.raw);
    })
    .join('');
}

function arrayValue(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
