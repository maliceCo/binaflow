export interface ViewportState {
  offset: number;
  selected: number;
}

export function moveSelection(
  state: ViewportState,
  delta: number,
  itemCount: number,
  visibleRows: number,
): ViewportState {
  if (itemCount === 0) return { offset: 0, selected: 0 };
  const selected = Math.max(0, Math.min(itemCount - 1, state.selected + delta));
  return keepSelectionVisible({ offset: state.offset, selected }, itemCount, visibleRows);
}

export function pageSelection(
  state: ViewportState,
  direction: -1 | 1,
  itemCount: number,
  visibleRows: number,
): ViewportState {
  return moveSelection(state, direction * Math.max(1, visibleRows - 1), itemCount, visibleRows);
}

export function scrollText(
  offset: number,
  delta: number,
  lineCount: number,
  visibleRows: number,
): number {
  const maximum = Math.max(0, lineCount - Math.max(1, visibleRows));
  return Math.max(0, Math.min(maximum, offset + delta));
}

export function keepSelectionVisible(
  state: ViewportState,
  itemCount: number,
  visibleRows: number,
): ViewportState {
  const rows = Math.max(1, visibleRows);
  const maximumOffset = Math.max(0, itemCount - rows);
  let offset = Math.max(0, Math.min(maximumOffset, state.offset));
  if (state.selected < offset) offset = state.selected;
  else if (state.selected >= offset + rows) offset = state.selected - rows + 1;
  offset = Math.max(0, Math.min(maximumOffset, offset));
  return { offset, selected: state.selected };
}
