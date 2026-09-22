import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Rnd } from 'react-rnd';
import { calculateCanvasRows, gridToPixels, pixelsToGrid } from '../geometry';
import type { BlockGeometry, WireframeBlockV1, WireframeDocumentV1 } from '../model';

interface CanvasProps {
  document: WireframeDocumentV1;
  selectedBlockId: string | null;
  onSelectBlock: (id: string) => void;
  onGeometryChange: (id: string, geometry: BlockGeometry) => void;
}

export function Canvas({
  document,
  selectedBlockId,
  onSelectBlock,
  onGeometryChange,
}: CanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(960);
  const rows = calculateCanvasRows(document.blocks);

  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;

    const updateWidth = () => {
      setCanvasWidth(element.clientWidth || 960);
    };
    updateWidth();

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const handleDragStop = (
    block: WireframeBlockV1,
    _event: unknown,
    data: { x: number; y: number },
  ) => {
    onGeometryChange(
      block.id,
      pixelsToGrid(
        {
          ...gridToPixels(block, canvasWidth, document.grid.rowHeight),
          x: data.x,
          y: data.y,
        },
        canvasWidth,
        document.grid.rowHeight,
      ),
    );
  };

  const handleResizeStop = (
    block: WireframeBlockV1,
    _event: unknown,
    _direction: unknown,
    ref: HTMLElement,
    _delta: unknown,
    position: { x: number; y: number },
  ) => {
    onGeometryChange(
      block.id,
      pixelsToGrid(
        {
          x: position.x,
          y: position.y,
          width: ref.offsetWidth,
          height: ref.offsetHeight,
        },
        canvasWidth,
        document.grid.rowHeight,
      ),
    );
  };

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
        <div
          ref={canvasRef}
          className="canvas-grid"
          data-testid="canvas"
          aria-label="Lienzo de wireframe"
          style={{ height: `${rows * document.grid.rowHeight + 16}px` }}
        >
          {document.blocks.map((block) => {
            const pixels = gridToPixels(block, canvasWidth, document.grid.rowHeight);
            return (
              <Rnd
                key={block.id}
                className={`canvas-block${selectedBlockId === block.id ? ' is-selected' : ''}`}
                data-testid={`wireframe-block-${block.id}`}
                size={{ width: pixels.width, height: pixels.height }}
                position={{ x: pixels.x, y: pixels.y }}
                minWidth={canvasWidth / document.grid.columns}
                minHeight={document.grid.rowHeight}
                bounds="parent"
                dragGrid={[canvasWidth / document.grid.columns, document.grid.rowHeight]}
                resizeGrid={[canvasWidth / document.grid.columns, document.grid.rowHeight]}
                onMouseDown={() => onSelectBlock(block.id)}
                onDragStop={(event, data) => handleDragStop(block, event, data)}
                onResizeStop={(event, direction, ref, delta, position) =>
                  handleResizeStop(block, event, direction, ref, delta, position)
                }
              >
                <CanvasBlockContent
                  block={block}
                  selected={selectedBlockId === block.id}
                  onSelect={() => onSelectBlock(block.id)}
                />
              </Rnd>
            );
          })}
          {document.blocks.length === 0 && (
            <p className="canvas-empty">Añade un bloque para comenzar a organizar la pantalla.</p>
          )}
        </div>
      </div>
    </section>
  );
}

interface CanvasBlockContentProps {
  block: WireframeBlockV1;
  selected: boolean;
  onSelect: () => void;
}

function CanvasBlockContent({ block, selected, onSelect }: CanvasBlockContentProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect();
    }
  };

  return (
    <div
      className="canvas-block-content"
      role="button"
      tabIndex={0}
      aria-label={`${block.title || 'Bloque sin título'} (${block.width} por ${block.height})`}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
    >
      <span className="canvas-block-title">{block.title || 'Sin título'}</span>
      <span className="canvas-block-description">{block.description || 'Sin descripción'}</span>
    </div>
  );
}
