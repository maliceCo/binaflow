import type { KeyboardEvent } from 'react';
import type { WireframeBlockV1, WireframeDocumentV1 } from '../model';

interface CanvasProps {
  document: WireframeDocumentV1;
  selectedBlockId: string | null;
  onSelectBlock: (id: string) => void;
}

export function Canvas({ document, selectedBlockId, onSelectBlock }: CanvasProps) {
  return (
    <section className="canvas-panel" aria-labelledby="canvas-title">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">Lienzo</p>
          <h2 id="canvas-title">Diseño de pantalla</h2>
        </div>
        <span className="grid-summary">{document.grid.columns} columnas</span>
      </div>
      <div className="canvas-scroll-area">
        <div className="canvas-grid" data-testid="canvas" aria-label="Lienzo de wireframe">
          {document.blocks.map((block) => (
            <CanvasBlock
              key={block.id}
              block={block}
              selected={selectedBlockId === block.id}
              onSelect={() => onSelectBlock(block.id)}
            />
          ))}
          {document.blocks.length === 0 && (
            <p className="canvas-empty">Añade un bloque para comenzar a organizar la pantalla.</p>
          )}
        </div>
      </div>
    </section>
  );
}

interface CanvasBlockProps {
  block: WireframeBlockV1;
  selected: boolean;
  onSelect: () => void;
}

function CanvasBlock({ block, selected, onSelect }: CanvasBlockProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect();
    }
  };

  return (
    <div
      className={`canvas-block${selected ? ' is-selected' : ''}`}
      data-testid={`wireframe-block-${block.id}`}
      role="button"
      tabIndex={0}
      aria-label={`${block.title || 'Bloque sin título'} (${block.width} por ${block.height})`}
      aria-pressed={selected}
      style={{
        gridColumn: `${block.x + 1} / span ${block.width}`,
        gridRow: `${block.y + 1} / span ${block.height}`,
      }}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
    >
      <span className="canvas-block-title">{block.title || 'Sin título'}</span>
      <span className="canvas-block-description">{block.description || 'Sin descripción'}</span>
    </div>
  );
}
