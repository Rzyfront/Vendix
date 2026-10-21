import {
  buildDiscrepancySignal,
  DISCREPANCY_ACK_PARAMETERS,
  DISCREPANCY_SIGNAL,
  discrepancyPreviewMessage,
  exceedsTolerance,
  moneyTolerance,
  readDiscrepancyAck,
} from './discrepancy-signal';

/**
 * Contrato puro de la pre-verificación guiada de discrepancias: tolerancia,
 * dirección, frase en lenguaje simple y lectura del reconocimiento.
 */
describe('discrepancy-signal', () => {
  const base = {
    process: 'cash_close',
    unit: 'COP',
    subject: 'Arqueo de la caja',
    causes_to_check: ['Reembolsos en efectivo sin registrar.'],
    reads_to_run: ['get_cash_session_close_report'],
    guide_questions: ['¿Sabes a qué se debe la diferencia?'],
  };

  describe('moneyTolerance / exceedsTolerance', () => {
    it('tolera el 0,1 % del esperado', () => {
      expect(moneyTolerance(500000)).toBe(500);
      expect(moneyTolerance(-500000)).toBe(500);
    });

    it('tiene piso de 1 unidad', () => {
      expect(moneyTolerance(0)).toBe(1);
      expect(moneyTolerance(300)).toBe(1);
    });

    it('solo excede estrictamente por encima de la tolerancia', () => {
      expect(exceedsTolerance(500, 500)).toBe(false);
      expect(exceedsTolerance(-500, 500)).toBe(false);
      expect(exceedsTolerance(500.01, 500)).toBe(true);
      expect(exceedsTolerance(-501, 500)).toBe(true);
      expect(exceedsTolerance(1, 0)).toBe(true);
      expect(exceedsTolerance(0, 0)).toBe(false);
    });
  });

  describe('buildDiscrepancySignal', () => {
    it('faltante: dirección shortage y frase con "faltan"', () => {
      const signal = buildDiscrepancySignal({
        ...base,
        expected: 350000,
        actual: 320000,
        tolerance: 350,
      });
      expect(signal.signal).toBe(DISCREPANCY_SIGNAL);
      expect(signal.difference).toBe(-30000);
      expect(signal.direction).toBe('shortage');
      expect(signal.plain_summary).toBe(
        'Arqueo de la caja: se esperaban $350.000 y hay $320.000; faltan $30.000.',
      );
      expect(signal.causes_to_check).toEqual(base.causes_to_check);
      expect(signal.reads_to_run).toEqual(base.reads_to_run);
      expect(signal.guide_questions).toEqual(base.guide_questions);
      expect(signal.how_to_proceed).toContain('discrepancy_reviewed=true');
    });

    it('sobrante: dirección surplus y frase con "sobran"', () => {
      const signal = buildDiscrepancySignal({
        ...base,
        expected: 100,
        actual: 112.5,
        tolerance: 1,
      });
      expect(signal.difference).toBe(12.5);
      expect(signal.direction).toBe('surplus');
      expect(signal.plain_summary).toContain('sobran $12,5');
    });

    it('en unidades no antepone el signo de moneda', () => {
      const signal = buildDiscrepancySignal({
        ...base,
        process: 'inventory_count',
        unit: 'unidades',
        subject: 'Café molido',
        expected: 20,
        actual: 17,
        tolerance: 0,
      });
      expect(signal.plain_summary).toBe(
        'Café molido: se esperaban 20 unidades y hay 17 unidades; faltan 3 unidades.',
      );
    });

    it('redondea la diferencia a centavos', () => {
      const signal = buildDiscrepancySignal({
        ...base,
        expected: 0.3,
        actual: 0.1,
        tolerance: 0,
      });
      expect(signal.difference).toBe(-0.2);
    });
  });

  describe('readDiscrepancyAck', () => {
    it('sin argumentos: no revisada y sin motivo', () => {
      expect(readDiscrepancyAck(undefined)).toEqual({
        reviewed: false,
        reason: null,
      });
      expect(readDiscrepancyAck({})).toEqual({ reviewed: false, reason: null });
    });

    it('solo acepta el booleano true como revisada', () => {
      expect(readDiscrepancyAck({ discrepancy_reviewed: 'true' }).reviewed).toBe(
        false,
      );
      expect(readDiscrepancyAck({ discrepancy_reviewed: true }).reviewed).toBe(
        true,
      );
    });

    it('recorta el motivo y descarta el vacío', () => {
      expect(
        readDiscrepancyAck({
          discrepancy_reviewed: true,
          discrepancy_reason: '  Pago al domiciliario  ',
        }),
      ).toEqual({ reviewed: true, reason: 'Pago al domiciliario' });
      expect(
        readDiscrepancyAck({ discrepancy_reviewed: true, discrepancy_reason: '   ' })
          .reason,
      ).toBeNull();
      expect(
        readDiscrepancyAck({ discrepancy_reviewed: true, discrepancy_reason: 5 })
          .reason,
      ).toBeNull();
    });
  });

  it('el mensaje del preview lleva la frase simple y cómo continuar', () => {
    const signal = buildDiscrepancySignal({
      ...base,
      expected: 1000,
      actual: 900,
      tolerance: 1,
    });
    const message = discrepancyPreviewMessage(signal);
    expect(message.startsWith(signal.plain_summary)).toBe(true);
    expect(message).toContain(signal.how_to_proceed);
  });

  it('los parámetros de reconocimiento son boolean + string', () => {
    expect(DISCREPANCY_ACK_PARAMETERS.discrepancy_reviewed.type).toBe('boolean');
    expect(DISCREPANCY_ACK_PARAMETERS.discrepancy_reason.type).toBe('string');
  });
});
