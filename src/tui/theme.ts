export type TuiColor =
  | 'black'
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'magenta'
  | 'cyan'
  | 'white'
  | 'gray'
  | 'grey'
  | undefined;

export interface TuiTheme {
  accent: TuiColor;
  success: TuiColor;
  warning: TuiColor;
  error: TuiColor;
  focus: TuiColor;
  muted: boolean;
}

export function createTuiTheme(colors: boolean): TuiTheme {
  return {
    accent: colors ? 'cyan' : undefined,
    success: colors ? 'green' : undefined,
    warning: colors ? 'yellow' : undefined,
    error: colors ? 'red' : undefined,
    focus: colors ? 'cyan' : undefined,
    muted: true,
  };
}

export function isNarrowTui(columns: number): boolean {
  return columns < 112;
}
