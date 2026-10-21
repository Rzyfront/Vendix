import { readFileSync } from 'fs';
import { resolve } from 'path';
import { GoldenTurnObservation, gradeGoldenTurn } from './graders';
import { USER_NOTICES } from '../../src/ai-engine/agent-execution.contract';

/**
 * Preguntas de conocimiento puro (Vexi en prod respondía `no_answer`): el
 * turno contesta en prosa útil, sin el aviso de último recurso ni jerga.
 */
const observe = (visible: string): GoldenTurnObservation => ({
  agent: 'vexi',
  visible,
  tools: [],
  errorFrame: false,
  proposed: false,
  known: new Set(),
});
const EXPECT = {
  expect_answer: { min_chars: 80, mentions_any: ['retención', 'certificado'] },
};

describe('gradeGoldenTurn — preguntas de conocimiento', () => {
  it('aprueba una respuesta en prosa que nombra el concepto', () => {
    const checks = gradeGoldenTurn(
      EXPECT,
      observe(
        'Tranquilo: la retención es un anticipo de impuesto que tu cliente descuenta del pago. Pídele el certificado de retención y guárdalo para tu declaración de renta.',
      ),
    );
    expect(Object.values(checks).every(Boolean)).toBe(true);
  });
  it.each([
    ['el aviso de último recurso', USER_NOTICES.no_answer],
    [
      'el aviso que vio el dueño en prod',
      'Esta vez no logré armar la respuesta. ¿Me lo pides de nuevo? Si quieres, dímelo con otras palabras y lo intento otra vez.',
    ],
    ['una respuesta vacía', ''],
    ['una respuesta corta sin sustancia', 'Claro, con gusto te ayudo.'],
  ])('reprueba %s', (_label, visible) => {
    const checks = gradeGoldenTurn(EXPECT, observe(visible));
    expect(Object.values(checks).every(Boolean)).toBe(false);
  });
  it('los 5 casos de conocimiento existen y exigen respuesta útil', () => {
    const cases = readFileSync(
      resolve(__dirname, 'golden-conversations.es.jsonl'),
      'utf8',
    )
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((c) => /^g4[1-5]-conocimiento/.test(c.id));
    expect(cases).toHaveLength(5);
    for (const c of cases) expect(c.turns[0].expect_answer).toBeDefined();
  });
});
