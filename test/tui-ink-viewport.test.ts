import { describe, expect, it } from 'vitest';
import {
  keepSelectionVisible,
  moveSelection,
  pageSelection,
  scrollText,
} from '../src/tui/viewport.js';

describe('Ink viewport state', () => {
  it('keeps selection visible while moving and paging', () => {
    const initial = { offset: 0, selected: 0 };
    expect(moveSelection(initial, 4, 10, 3)).toEqual({ offset: 2, selected: 4 });
    expect(pageSelection({ offset: 2, selected: 4 }, 1, 10, 3)).toEqual({
      offset: 4,
      selected: 6,
    });
    expect(pageSelection({ offset: 4, selected: 6 }, -1, 10, 3)).toEqual({
      offset: 4,
      selected: 4,
    });
  });

  it('bounds text scrolling and repairs stale selection offsets', () => {
    expect(scrollText(0, -1, 20, 5)).toBe(0);
    expect(scrollText(0, 99, 20, 5)).toBe(15);
    expect(keepSelectionVisible({ offset: 99, selected: 1 }, 20, 5)).toEqual({
      offset: 1,
      selected: 1,
    });
  });

  it('lets long content reach the final line and keeps selection visible with explicit offset', () => {
    const lineCount = 40;
    const visibleRows = 6;
    const finalOffset = scrollText(0, 1_000, lineCount, visibleRows);
    expect(finalOffset).toBe(lineCount - visibleRows);
    expect(finalOffset + visibleRows).toBe(lineCount);

    let state = { offset: 0, selected: 0 };
    for (let index = 0; index < lineCount; index += 1) {
      state = moveSelection(state, 1, lineCount, visibleRows);
    }
    expect(state.selected).toBe(lineCount - 1);
    expect(state.selected).toBeGreaterThanOrEqual(state.offset);
    expect(state.selected).toBeLessThan(state.offset + visibleRows);
  });
});
