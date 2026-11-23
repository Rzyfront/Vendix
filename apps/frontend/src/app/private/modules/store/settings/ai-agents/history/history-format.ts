const DATE_TIME = new Intl.DateTimeFormat('es-CO', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function formatHistoryDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : DATE_TIME.format(date);
}

export function agentLabel(key: string | null | undefined): string {
  return key === 'vex' ? 'Vex' : key === 'vexi' ? 'Vexi' : '—';
}
