import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import { sanitizeInkText } from './text.js';

export interface ScreenFrameProps {
  title: string;
  subtitle?: string;
  status?: string | undefined;
  footer: string;
  colors: boolean;
  children: ReactNode;
}

export function ScreenFrame({
  title,
  subtitle,
  status,
  footer,
  colors,
  children,
}: ScreenFrameProps): ReactNode {
  return (
    <Box flexDirection="column">
      {colors ? (
        <Text bold color="cyan">
          {sanitizeInkText(title)}
        </Text>
      ) : (
        <Text bold>{sanitizeInkText(title)}</Text>
      )}
      {subtitle ? <Text dimColor>{sanitizeInkText(subtitle)}</Text> : null}
      <Text>{' '.repeat(1)}</Text>
      {children}
      {status ? (
        colors ? (
          <Text color="yellow">Status: {sanitizeInkText(status)}</Text>
        ) : (
          <Text>Status: {sanitizeInkText(status)}</Text>
        )
      ) : null}
      <Text>{' '.repeat(1)}</Text>
      <Text dimColor>{sanitizeInkText(footer)}</Text>
    </Box>
  );
}

export interface SelectionListProps {
  items: string[];
  selected: number;
  offset: number;
  visibleRows: number;
}

export function SelectionList({
  items,
  selected,
  offset,
  visibleRows,
}: SelectionListProps): ReactNode {
  const rows = items.slice(offset, offset + Math.max(1, visibleRows));
  return (
    <Box flexDirection="column">
      {offset > 0 ? <Text dimColor>^ previous items</Text> : null}
      {rows.map((item, index) => {
        const itemIndex = offset + index;
        return (
          <Text key={`${itemIndex}-${item}`}>
            {itemIndex === selected ? '> ' : '  '}
            {sanitizeInkText(item)}
          </Text>
        );
      })}
      {offset + rows.length < items.length ? <Text dimColor>v more items</Text> : null}
    </Box>
  );
}

export interface TextViewportProps {
  lines: string[];
  offset: number;
  visibleRows: number;
}

export function TextViewport({ lines, offset, visibleRows }: TextViewportProps): ReactNode {
  const rows = lines.slice(offset, offset + Math.max(1, visibleRows));
  return (
    <Box flexDirection="column">
      {offset > 0 ? <Text dimColor>^ previous content</Text> : null}
      {rows.map((line, index) => (
        <Text key={`${offset + index}-${line}`}>{sanitizeInkText(line)}</Text>
      ))}
      {offset + rows.length < lines.length ? <Text dimColor>v more content</Text> : null}
    </Box>
  );
}

export function StatusMessage({
  message,
  error = false,
}: {
  message: string;
  error?: boolean;
}): ReactNode {
  return error ? (
    <Text color="red">{sanitizeInkText(message)}</Text>
  ) : (
    <Text>{sanitizeInkText(message)}</Text>
  );
}

export function TextPrompt({ prompt, value }: { prompt: string; value: string }): ReactNode {
  return (
    <Text>
      {sanitizeInkText(prompt)}
      {sanitizeInkText(value)}
    </Text>
  );
}

export function Confirmation({
  message,
  selected,
}: {
  message: string;
  selected: number;
}): ReactNode {
  return (
    <Box flexDirection="column">
      <Text>{sanitizeInkText(message)}</Text>
      <Text>{selected === 0 ? '> ' : '  '}Yes</Text>
      <Text>{selected === 1 ? '> ' : '  '}No</Text>
    </Box>
  );
}

export function MinimumSizeFallback(): ReactNode {
  return (
    <Box flexDirection="column">
      <Text>Binaflow</Text>
      <Text>Terminal too small for this screen.</Text>
      <Text>Resize to at least 56 columns x 12 rows.</Text>
      <Text>Press q to quit.</Text>
    </Box>
  );
}
