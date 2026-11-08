import {
  formatDuration,
  formatLatency,
  formatPercent,
  outboxKindLabel,
} from './workflows-ops.format';

describe('workflows-ops format', () => {
  it('formats durations in the unit a person reads', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(725)).toBe('12 min');
    expect(formatDuration(7500)).toBe('2 h 5 min');
    expect(formatDuration(7200)).toBe('2 h');
  });

  it('formats latency below a minute with one decimal and above as a duration', () => {
    expect(formatLatency(null)).toBe('—');
    expect(formatLatency(0.04)).toBe((0).toLocaleString('es-CO') + ' s');
    expect(formatLatency(120)).toBe('2 min');
  });

  it('formats a success rate as a percentage and no data as a dash', () => {
    expect(formatPercent(0.8)).toBe('80 %');
    expect(formatPercent(null)).toBe('—');
  });

  it('names each outbox kind in Spanish and keeps an unknown one as it came', () => {
    expect(outboxKindLabel('ai_step')).toBe('Paso de IA');
    expect(outboxKindLabel('webhook')).toBe('Webhook saliente');
    expect(outboxKindLabel('gate_resolved')).toBe('Aprobación resuelta');
    expect(outboxKindLabel('nuevo_tipo')).toBe('nuevo_tipo');
    expect(outboxKindLabel(null)).toBe('—');
  });
});
