import { describe, expect, it } from 'vitest';
import {
  keepSelectionVisible,
  moveSelection,
  pageSelection,
  scrollText,
} from '../src/tui-ink/viewport.js';

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
});
