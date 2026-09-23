import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Rnd } from 'react-rnd';
import { calculateCanvasRows, gridToPixels, pixelsToGrid } from '../geometry';
import type { BlockGeometry, WireframeBlockV2, WireframeDocumentV2 } from '../model';

interface CanvasProps {
  document: WireframeDocumentV2;
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
  const rows = calculateCanvasRows(document.blocks, document.canvas.rows);

  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;

    const updateWidth = () => setCanvasWidth(element.clientWidth || 960);
    updateWidth();
    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const sortedBlocks = [
    ...document.blocks.filter((block) => block.parentId === null),
    ...document.blocks.filter((block) => block.parentId !== null),
  ];

  const handleDragStop = (
    block: WireframeBlockV2,
    _event: unknown,
    data: { x: number; y: number },
  ) => {
    const parent = getParent(document, block);
    const parentPixels = parent ? gridToPixels(parent, canvasWidth, document.grid.rowHeight) : null;
    const local = pixelsToGrid(
      {
        ...gridToPixels(block, canvasWidth, document.grid.rowHeight),
        x: data.x - (parentPixels?.x ?? 0),
        y: data.y - (parentPixels?.y ?? 0),
      },
      canvasWidth,
      document.grid.rowHeight,
    );
    onGeometryChange(block.id, local);
  };

  const handleResizeStop = (
    block: WireframeBlockV2,
    _event: unknown,
    _direction: unknown,
    ref: HTMLElement,
    _delta: unknown,
    position: { x: number; y: number },
  ) => {
    const parent = getParent(document, block);
    const parentPixels = parent ? gridToPixels(parent, canvasWidth, document.grid.rowHeight) : null;
    onGeometryChange(
      block.id,
      pixelsToGrid(
        {
          x: position.x - (parentPixels?.x ?? 0),
          y: position.y - (parentPixels?.y ?? 0),
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
        <span className="grid-summary">
          {document.grid.columns} columnas · {rows} filas
        </span>
      </div>
      <div className="canvas-scroll-area">
        <div
          ref={canvasRef}
          className="canvas-grid"
          data-testid="canvas"
          aria-label="Lienzo de wireframe"
          style={{ height: `${rows * document.grid.rowHeight + 16}px` }}
        >
          {sortedBlocks.map((block) => {
            const localPixels = gridToPixels(block, canvasWidth, document.grid.rowHeight);
            const parent = getParent(document, block);
            const parentPixels = parent
              ? gridToPixels(parent, canvasWidth, document.grid.rowHeight)
              : null;
            const position = {
              x: localPixels.x + (parentPixels?.x ?? 0),
              y: localPixels.y + (parentPixels?.y ?? 0),
            };
            const bounds = parent ? `[data-testid="wireframe-block-${parent.id}"]` : 'parent';
            const maxWidth = parent
              ? (parent.width - block.x) * (canvasWidth / document.grid.columns)
              : (document.grid.columns - block.x) * (canvasWidth / document.grid.columns);
            const maxHeight = parent
              ? (parent.height - block.y) * document.grid.rowHeight
              : (rows - block.y) * document.grid.rowHeight;

            return (
              <Rnd
                key={block.id}
                className={`canvas-block${parent ? ' is-child' : ''}${selectedBlockId === block.id ? ' is-selected' : ''}`}
                data-testid={`wireframe-block-${block.id}`}
                size={{ width: localPixels.width, height: localPixels.height }}
                position={position}
                minWidth={canvasWidth / document.grid.columns}
                minHeight={document.grid.rowHeight}
                maxWidth={maxWidth}
                maxHeight={maxHeight}
                bounds={bounds}
                dragGrid={[canvasWidth / document.grid.columns, document.grid.rowHeight]}
                resizeGrid={[canvasWidth / document.grid.columns, document.grid.rowHeight]}
                onMouseDown={() => onSelectBlock(block.id)}
                onDragStop={(event, data) => handleDragStop(block, event, data)}
                onResizeStop={(event, direction, ref, delta, resizedPosition) =>
                  handleResizeStop(block, event, direction, ref, delta, resizedPosition)
                }
              >
                <CanvasBlockContent
                  block={block}
                  parentTitle={parent?.title}
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

function getParent(document: WireframeDocumentV2, block: WireframeBlockV2) {
  return block.parentId === null
    ? undefined
    : document.blocks.find((candidate) => candidate.id === block.parentId);
}

interface CanvasBlockContentProps {
  block: WireframeBlockV2;
  parentTitle: string | undefined;
  selected: boolean;
  onSelect: () => void;
}

function CanvasBlockContent({ block, parentTitle, selected, onSelect }: CanvasBlockContentProps) {
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
      aria-label={`${block.title || 'Bloque sin título'}${parentTitle ? ` dentro de ${parentTitle}` : ''} (${block.width} por ${block.height})`}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
    >
      {parentTitle && <span className="canvas-block-parent">Dentro de {parentTitle}</span>}
      <span className="canvas-block-title">{block.title || 'Sin título'}</span>
      <span className="canvas-block-description">{block.description || 'Sin descripción'}</span>
    </div>
  );
}
