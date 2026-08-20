import { Box, Text, type TextProps } from 'ink';
import { Fragment, type ReactNode } from 'react';
import { sanitizeInkText } from './text.js';

/** Centralized dynamic text rendering; all user/persisted strings pass through sanitization. */
export function SafeText({ children, ...props }: TextProps): ReactNode {
  return <Text {...props}>{sanitizeNode(children)}</Text>;
}

export function AppFrame({ children }: { children: ReactNode }): ReactNode {
  return (
    <Box flexDirection="column" width="100%" height="100%" borderStyle="single" paddingX={1}>
      {children}
    </Box>
  );
}

export function Panel({
  children,
  focused = false,
  colors,
  width,
  flexGrow,
}: {
  children: ReactNode;
  focused?: boolean;
  colors: boolean;
  width?: number | string;
  flexGrow?: number;
}): ReactNode {
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      {...(focused && colors ? { borderColor: 'cyan' as const } : {})}
      {...(width !== undefined ? { width } : {})}
      {...(flexGrow !== undefined ? { flexGrow } : {})}
      paddingX={1}
    >
      {children}
    </Box>
  );
}

export function StatusBar({ children }: { children: ReactNode }): ReactNode {
  return (
    <Box borderStyle="single" flexDirection="column" paddingX={1}>
      {children}
    </Box>
  );
}

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
    <Box flexDirection="column" borderStyle="single" paddingX={1}>
      {colors ? (
        <SafeText bold color="cyan">
          {title}
        </SafeText>
      ) : (
        <SafeText bold>{title}</SafeText>
      )}
      {subtitle ? <SafeText dimColor>{subtitle}</SafeText> : null}
      <Text> </Text>
      {children}
      {status ? (
        colors ? (
          <SafeText color="yellow">{`Status: ${status}`}</SafeText>
        ) : (
          <SafeText>{`Status: ${status}`}</SafeText>
        )
      ) : null}
      <Text> </Text>
      <SafeText dimColor>{footer}</SafeText>
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
      {offset > 0 ? <SafeText dimColor>^ previous items</SafeText> : null}
      {rows.map((item, index) => {
        const itemIndex = offset + index;
        return (
          <SafeText key={`${itemIndex}-${item}`}>
            {`${itemIndex === selected ? '> ' : '  '}${item}`}
          </SafeText>
        );
      })}
      {offset + rows.length < items.length ? <SafeText dimColor>v more items</SafeText> : null}
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
      {offset > 0 ? <SafeText dimColor>^ previous content</SafeText> : null}
      {rows.map((line, index) => (
        <SafeText key={`${offset + index}-${line}`}>{line}</SafeText>
      ))}
      {offset + rows.length < lines.length ? <SafeText dimColor>v more content</SafeText> : null}
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
  return error ? <SafeText color="red">{message}</SafeText> : <SafeText>{message}</SafeText>;
}

export function MinimumSizeFallback(): ReactNode {
  return (
    <Box flexDirection="column">
      <SafeText>Binaflow</SafeText>
      <SafeText>Terminal too small for this screen.</SafeText>
      <SafeText>Resize to at least 56 columns x 12 rows.</SafeText>
      <SafeText>Press q to quit.</SafeText>
    </Box>
  );
}

function sanitizeNode(node: ReactNode): ReactNode {
  if (node === null || node === undefined || typeof node === 'boolean') return node;
  if (typeof node === 'string' || typeof node === 'number') {
    return sanitizeInkText(String(node));
  }
  if (Array.isArray(node)) {
    return node.map((child, index) => <Fragment key={index}>{sanitizeNode(child)}</Fragment>);
  }
  return node;
}
