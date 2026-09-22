import { calculateCanvasRows, gridToPixels, pixelsToGrid } from './geometry';
import type { WireframeBlockV1 } from './model';

describe('wireframe geometry', () => {
  it('converts grid geometry to pixels for different canvas widths', () => {
    expect(gridToPixels({ x: 1, y: 2, width: 3, height: 4 }, 1200, 40)).toEqual({
      x: 100,
      y: 80,
      width: 300,
      height: 160,
    });
    expect(gridToPixels({ x: 1, y: 2, width: 3, height: 4 }, 960, 40)).toEqual({
      x: 80,
      y: 80,
      width: 240,
      height: 160,
    });
  });

  it('rounds pixels back to grid units and clamps invalid geometry', () => {
    expect(pixelsToGrid({ x: 101, y: 79, width: 299, height: 161 }, 1200, 40)).toEqual({
      x: 1,
      y: 2,
      width: 3,
      height: 4,
    });
    expect(pixelsToGrid({ x: 1190, y: -20, width: 400, height: 0 }, 1200, 40)).toEqual({
      x: 11,
      y: 0,
      width: 1,
      height: 1,
    });
  });

  it('keeps a safe result when the canvas width is not measured yet', () => {
    expect(gridToPixels({ x: 1, y: 0, width: 1, height: 1 }, 0, 40)).toEqual({
      x: 1,
      y: 0,
      width: 1,
      height: 40,
    });
  });

  it('keeps 18 rows minimum and adds two rows below the lowest block', () => {
    const blocks: WireframeBlockV1[] = [
      { id: 'a', title: '', description: '', x: 0, y: 0, width: 1, height: 1 },
      { id: 'b', title: '', description: '', x: 0, y: 20, width: 1, height: 3 },
    ];

    expect(calculateCanvasRows([])).toBe(18);
    expect(calculateCanvasRows([{ ...blocks[0]!, y: 15, height: 1 }])).toBe(18);
    expect(calculateCanvasRows(blocks)).toBe(25);
  });
});
