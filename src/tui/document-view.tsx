import type { DocumentPage } from '../application/preparation.js';
import { PaneSection, SafeText, TextViewport } from './components.js';
import { MarkdownView } from './markdown.js';

export function DocumentView({ page, visibleRows }: { page: DocumentPage; visibleRows: number }) {
  const lines = page.content.split('\n');
  return (
    <PaneSection title="Document" colors first>
      <SafeText dimColor>
        {`${page.startOffset}-${page.endOffset}${page.startsMidLine ? ' (continues)' : ''}${page.endsMidLine ? ' (continued)' : ''}`}
      </SafeText>
      {page.format === 'markdown' ? (
        <MarkdownView
          source={page.content}
          colors
          partial={page.startsMidLine || page.endsMidLine}
        />
      ) : (
        <TextViewport lines={lines} offset={0} visibleRows={Math.max(1, visibleRows - 1)} />
      )}
      {page.limitations.map((limitation) => (
        <SafeText key={limitation} dimColor>{`Limit: ${limitation}`}</SafeText>
      ))}
    </PaneSection>
  );
}
