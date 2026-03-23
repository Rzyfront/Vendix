const VALID_TRANSITIONS: Record<string, string[]> = {
  pending: ['active', 'cancelled'],
  active: ['paid', 'overdue', 'cancelled'],
  overdue: ['active', 'paid', 'cancelled', 'defaulted'],
  paid: [],
  cancelled: [],
  defaulted: ['cancelled'],
};

export function canTransition(from: string, to: string): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function getValidTransitions(state: string): string[] {
  return VALID_TRANSITIONS[state] ?? [];
}
