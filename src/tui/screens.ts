export const HOME_ACTIONS: string[] = [
  'New workflow',
  'Read documentation',
  'Refresh diagnosis',
  'Run history',
  'Exit',
  'Diagnosis',
];

export const MINIMUM_WIDTH = 56;
export const MINIMUM_HEIGHT = 12;

export type Screen =
  | 'home'
  | 'documentation'
  | 'diagnosis'
  | 'setup-wizard'
  | 'workflows'
  | 'launch-input'
  | 'launch-confirmation'
  | 'live'
  | 'completion'
  | 'history'
  | 'detail'
  | 'artifacts'
  | 'approval-feedback';
