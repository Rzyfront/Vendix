export type TimelineStepStatus = 'completed' | 'current' | 'upcoming' | 'pending' | 'terminal';
export type TimelineVariant = 'success' | 'danger' | 'warning' | 'default';
export type TimelineSize = 'sm' | 'md';

export interface TimelineStep {
  key: string;
  label: string;
  status: TimelineStepStatus;
  variant?: TimelineVariant;
  data?: any;
  description?: string;
  date?: string;
}
