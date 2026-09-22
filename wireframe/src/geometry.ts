import {
  GRID_COLUMNS,
  normalizeBlockGeometry,
  type BlockGeometry,
  type WireframeBlockV1,
} from './model';

export interface PixelRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function gridToPixels(
  geometry: BlockGeometry,
  canvasWidth: number,
  rowHeight: number,
): PixelRectangle {
  const columnWidth = safeCanvasWidth(canvasWidth) / GRID_COLUMNS;

  return {
    x: geometry.x * columnWidth,
    y: geometry.y * rowHeight,
    width: geometry.width * columnWidth,
    height: geometry.height * rowHeight,
  };
}

export function pixelsToGrid(
  rectangle: PixelRectangle,
  canvasWidth: number,
  rowHeight: number,
): BlockGeometry {
  const columnWidth = safeCanvasWidth(canvasWidth) / GRID_COLUMNS;

  return normalizeBlockGeometry({
    x: rectangle.x / columnWidth,
    y: rectangle.y / rowHeight,
    width: rectangle.width / columnWidth,
    height: rectangle.height / rowHeight,
  });
}

export function calculateCanvasRows(blocks: WireframeBlockV1[]): number {
  const lowestBlock = blocks.reduce((lowest, block) => Math.max(lowest, block.y + block.height), 0);
  return Math.max(18, lowestBlock + 2);
}

function safeCanvasWidth(canvasWidth: number): number {
  return canvasWidth > 0 && Number.isFinite(canvasWidth) ? canvasWidth : GRID_COLUMNS;
}
