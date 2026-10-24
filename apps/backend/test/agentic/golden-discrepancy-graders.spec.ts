import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  GOLDEN_NO_ANSWER,
  GoldenTurnObservation,
  gradeGoldenTurn,
} from './graders';

/**
 * Graders de la pre-verificación guiada de discrepancias: con diferencia el
 * turno guía (pregunta el motivo, nombra causas, no propone); sin diferencia
 * propone directo y no interroga.
 */
const observe = (
  visible: string,
  overrides: Partial<GoldenTurnObservation> = {},
): GoldenTurnObservation => ({
  agent: 'vexi',
  visible,
  tools: [{ frame: 'tool_call', name: 'get_cash_session_close_report' }],
  errorFrame: false,
  proposed: false,
  known: new Set(),
  ...overrides,
});

const CAUSES = { causes_any: ['cancelad', 'reembols', 'salida'] };

describe('gradeGoldenTurn — guía de discrepancias', () => {
  it('aprueba una guía que pregunta el motivo y nombra causas sin proponer', () => {
    const checks = gradeGoldenTurn(
      { expect_guidance: CAUSES },
      observe(
        'Se esperaban $350.000 y contaste $320.000: faltan $30.000. ¿Sabes a qué se debe? Revisemos si hubo órdenes canceladas o reembolsos que no quedaron registrados.',
      ),
    );
    expect(checks.guide_before_write).toBe(true);
    expect(checks.warm_tone).toBe(true);
  });

  it('reprueba la guía si la escritura ya quedó propuesta', () => {
    const checks = gradeGoldenTurn(
      { expect_guidance: CAUSES },
      observe('¿Sabes el motivo? Puede ser un reembolso.', { proposed: true }),
    );
    expect(checks.guide_before_write).toBe(false);
  });

  it('reprueba la guía sin causas concretas', () => {
    const checks = gradeGoldenTurn(
      { expect_guidance: CAUSES },
      observe('Hay una diferencia. ¿Sabes el motivo?'),
    );
    expect(checks.guide_before_write).toBe(false);
  });

  it('compara causas sin acentos ni mayúsculas', () => {
    const checks = gradeGoldenTurn(
      { expect_guidance: { causes_any: ['devoluci'] } },
      observe('¿Conoces el motivo? Mira las DEVOLUCIÓNES del turno.'),
    );
    expect(checks.guide_before_write).toBe(true);
  });

  it('marca el regaño como tono incorrecto', () => {
    const checks = gradeGoldenTurn(
      { expect_guidance: CAUSES },
      observe(
        '¿Sabes el motivo? Deberías haber registrado los reembolsos cancelados.',
      ),
    );
    expect(checks.warm_tone).toBe(false);
  });

  it('un cierre que cuadra no pregunta por diferencias', () => {
    expect(
      gradeGoldenTurn(
        { expect_write: true, expect_no_guidance: true },
        observe('Te dejé listo el cierre con $350.000; apruébalo cuando quieras.', {
          proposed: true,
        }),
      ).no_needless_guidance,
    ).toBe(true);
    expect(
      gradeGoldenTurn(
        { expect_no_guidance: true },
        observe('Antes de cerrar, ¿conoces el motivo de la diferencia?'),
      ).no_needless_guidance,
    ).toBe(false);
  });

  it('la suite trae al menos seis casos de discrepancia bien formados', () => {
    const cases = readFileSync(
      resolve(__dirname, 'golden-conversations.es.jsonl'),
      'utf8',
    )
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const discrepancy = cases.filter((testCase) =>
      testCase.turns.some(
        (turn: any) => turn.expect_guidance || turn.expect_no_guidance,
      ),
    );
    expect(discrepancy.length).toBeGreaterThanOrEqual(6);
    expect(discrepancy.some((testCase) => testCase.agent === 'vex')).toBe(true);
    for (const testCase of discrepancy)
      for (const statement of [
        ...(testCase.setup_sql ?? []),
        ...(testCase.teardown_sql ?? []),
      ])
        expect(statement).not.toMatch(/\b(delete|truncate|drop)\b/i);
  });
});

describe('gradeGoldenTurn — turno sin texto del modelo', () => {
  it('reprueba el aviso enlatado del chat, el actual y el de producción', () => {
    for (const notice of GOLDEN_NO_ANSWER)
      expect(gradeGoldenTurn({}, observe(notice)).no_canned_answer).toBe(false);
  });

  it('aprueba el resumen que escribió el modelo tras sus herramientas', () => {
    const checks = gradeGoldenTurn(
      {},
      observe('Tienes 3 productos con poco stock: Café, Azúcar y Leche.'),
    );
    expect(checks.no_canned_answer).toBe(true);
  });
});
