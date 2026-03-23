const VALID_TRANSITIONS: Record<string, string[]> = {
  pending: ['approved', 'rejected', 'cancelled'],
  approved: ['repaying', 'cancelled'],
  repaying: ['paid', 'cancelled'],
  paid: [],
  rejected: [],
  cancelled: [],
};

export function validateAdvanceTransition(current: string, target: string): boolean {
  return VALID_TRANSITIONS[current]?.includes(target) ?? false;
}

export function getAvailableTransitions(current: string): string[] {
  return VALID_TRANSITIONS[current] ?? [];
}
