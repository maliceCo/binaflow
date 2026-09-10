import stringWidth from 'string-width';
import { Box } from 'ink';
import type { ReactNode } from 'react';
import { SafeText } from './components.js';

export function MessageEditor({
  value,
  colors,
  active,
}: {
  value: string;
  colors: boolean;
  active: boolean;
}): ReactNode {
  const lines = value.split('\n');
  const width = Math.max(0, ...lines.map((line) => stringWidth(line)));
  return (
    <Box flexDirection="column">
      {lines.map((line, index) => (
        <SafeText
          key={`${index}-${line}`}
          {...(active && colors ? { color: 'cyan' as const } : {})}
        >
          {`${index === 0 ? '> ' : '  '}${line || (index === 0 && active ? ' ' : '')}`}
        </SafeText>
      ))}
      <SafeText dimColor>{`${value.length} UTF-16 units, ${width} columns`}</SafeText>
    </Box>
  );
}
