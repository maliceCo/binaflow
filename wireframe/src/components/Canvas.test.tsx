import { fireEvent, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Canvas } from './Canvas';
import type { WireframeDocumentV2 } from '../model';

interface MockRndProps {
  children: ReactNode;
  onDragStop: (event: MouseEvent, data: { x: number; y: number }) => void;
  onResizeStop: (
    event: MouseEvent,
    direction: string,
    ref: HTMLElement,
    delta: { width: number; height: number },
    position: { x: number; y: number },
  ) => void;
}

vi.mock('react-rnd', () => ({
  Rnd: ({ children, onDragStop, onResizeStop }: MockRndProps) => {
    const resizeElement = document.createElement('div');
    Object.defineProperty(resizeElement, 'offsetWidth', { value: 480 });
    Object.defineProperty(resizeElement, 'offsetHeight', { value: 120 });

    return (
      <div>
        {children}
        <button
          type="button"
          data-testid="mock-drag"
          onClick={() => onDragStop(new MouseEvent('mouseup'), { x: 240, y: 80 })}
        >
          mock drag
        </button>
        <button
          type="button"
          data-testid="mock-resize"
          onClick={() =>
            onResizeStop(
              new MouseEvent('mouseup'),
              'bottomRight',
              resizeElement,
              { width: 0, height: 0 },
              { x: 80, y: 40 },
            )
          }
        >
          mock resize
        </button>
      </div>
    );
  },
}));

const wireframeDocument: WireframeDocumentV2 = {
  version: 2,
  name: 'Prueba',
  grid: { columns: 12, rowHeight: 40 },
  canvas: { rows: 18 },
  blocks: [
    {
      id: 'block-1',
      parentId: null,
      title: 'Panel',
      description: 'Descripción',
      x: 0,
      y: 0,
      width: 3,
      height: 3,
    },
  ],
};

describe('Canvas', () => {
  it('publishes snapped grid geometry after drag and resize finish', () => {
    const onGeometryChange = vi.fn();
    render(
      <Canvas
        document={wireframeDocument}
        selectedBlockId="block-1"
        onSelectBlock={vi.fn()}
        onGeometryChange={onGeometryChange}
      />,
    );

    fireEvent.click(document.querySelector('[data-testid="mock-drag"]')!);
    expect(onGeometryChange).toHaveBeenLastCalledWith('block-1', {
      x: 3,
      y: 2,
      width: 3,
      height: 3,
    });

    fireEvent.click(document.querySelector('[data-testid="mock-resize"]')!);
    expect(onGeometryChange).toHaveBeenLastCalledWith('block-1', {
      x: 1,
      y: 1,
      width: 6,
      height: 3,
    });
  });
});
