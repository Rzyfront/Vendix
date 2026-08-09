import {
  canWriteEnablementStatus,
  decideNotePhase,
  NOTE_PHASE_MAX_POLLS,
} from './note-phase-gate.util';

/**
 * `enabled` es TERMINAL y lo concede la DIAN. Ninguna rama de `executeTestSet`
 * vuelve a él, así que si una corrida pudiera escribirlo degradaría una
 * habilitación que solo el portal devuelve a mano.
 */
describe('canWriteEnablementStatus', () => {
  it('niega la escritura sobre una config ya habilitada', () => {
    expect(canWriteEnablementStatus('enabled')).toBe(false);
  });

  it('permite la escritura en los estados que sí son de tránsito', () => {
    for (const state of [
      'not_started',
      'testing',
      'test_set_passed',
      'rejected',
    ]) {
      expect(canWriteEnablementStatus(state)).toBe(true);
    }
  });

  it('permite la escritura cuando el estado falta', () => {
    // Una config sin estado todavía no ha ganado nada que perder.
    expect(canWriteEnablementStatus(null)).toBe(true);
    expect(canWriteEnablementStatus(undefined)).toBe(true);
  });
});

/**
 * Cada decisión de esta puerta cuesta consecutivos autorizados irrecuperables si
 * sale mal: transmitir antes de tiempo quema 20 números para cosechar los mismos
 * CBG04a/DBG04a que el envío en dos fases existe para eliminar. Por eso las
 * aserciones nombran la regla de la DIAN que previenen — sin el código de regla
 * parecen preferencias de estilo y alguien las "simplifica".
 */
describe('decideNotePhase', () => {
  // Composición real del set de habilitación de la plataforma.
  const INVOICES = 30;

  function decide(overrides: Partial<Parameters<typeof decideNotePhase>[0]> = {}) {
    return decideNotePhase({
      invoice_zip_key_count: INVOICES,
      accepted: 0,
      rejected: 0,
      poll: 1,
      ...overrides,
    });
  }

  describe('las notas NO se transmiten mientras el agregado no reporte aceptación', () => {
    it('sigue esperando con ninguna factura aceptada', () => {
      const d = decide({ accepted: 0 });
      expect(d.action).toBe('keep_waiting');
    });

    it('sigue esperando con 29 de 30 — el mínimo del portal NO es el criterio aquí', () => {
      // `aggregateZipVerdicts` declararía éxito con 1 aceptada, porque ese es el
      // criterio de APROBACIÓN DEL SET. Aplicarlo aquí mandaría las notas cuando
      // la factura que una de ellas referencia todavía no está registrada.
      const d = decide({ accepted: INVOICES - 1 });
      expect(d.action).toBe('keep_waiting');
      expect(d.reason).toContain('29 de 30');
    });

    it('sigue esperando incluso con una sola factura aceptada', () => {
      expect(decide({ accepted: 1 }).action).toBe('keep_waiting');
    });

    it('transmite solo cuando TODAS están registradas', () => {
      const d = decide({ accepted: INVOICES, poll: 4 });
      expect(d.action).toBe('send_notes');
      expect(d.reason).toContain('30 facturas quedaron registradas');
      expect(d.reason).toContain('4 consultas');
    });
  });

  describe('el tope de espera agotado difiere las notas, no las descarta', () => {
    it('difiere en el último sondeo y dice cuántas faltaban', () => {
      const d = decide({ accepted: 28, poll: NOTE_PHASE_MAX_POLLS });
      expect(d.action).toBe('defer_notes');
      // El mensaje es lo que el operador lee para decidir: tiene que traer el
      // recuento, no un «no se pudo».
      expect(d.reason).toContain('Tope de espera agotado');
      expect(d.reason).toContain('28 de 30');
      expect(d.reason).toContain('generadas y sin transmitir');
    });

    it('no difiere un sondeo antes del tope', () => {
      expect(decide({ accepted: 28, poll: NOTE_PHASE_MAX_POLLS - 1 }).action).toBe(
        'keep_waiting',
      );
    });

    /**
     * `defer_notes` no es un fallo terminal ni una orden de descartar: las notas
     * quedan firmadas con su consecutivo reservado y el llamador las persiste.
     * Esta aserción existe para que el contrato del veredicto no se confunda con
     * el de `rejected`, que sí cierra el lote.
     */
    it('difiere sin marcar el lote como rechazado — son estados distintos', () => {
      const d = decide({ accepted: 28, poll: NOTE_PHASE_MAX_POLLS });
      expect(d.action).toBe('defer_notes');
      expect(d.action).not.toBe('send_notes');
      // El texto nunca debe afirmar que la DIAN rechazó algo: no lo hizo.
      expect(d.reason).not.toMatch(/rechaz/i);
    });
  });

  describe('un rechazo corta la espera de inmediato', () => {
    it('difiere en cuanto la DIAN rechaza una factura', () => {
      // Seguir sondeando no convierte un rechazo en aceptación, y cada sondeo
      // extra son 30 s de retraso en el diagnóstico.
      const d = decide({ accepted: 29, rejected: 1, poll: 2 });
      expect(d.action).toBe('defer_notes');
      expect(d.reason).toContain('rechazó 1 de 30');
    });

    it('el rechazo gana sobre el total aceptado, que no puede coexistir', () => {
      // Defensa contra un agregado incoherente: si llegan las dos señales, la que
      // impide emitir es la que manda.
      const d = decide({ accepted: INVOICES, rejected: 1 });
      expect(d.action).toBe('defer_notes');
    });
  });

  describe('sin ZipKey no hay nada registrado', () => {
    it('difiere cuando ninguna factura obtuvo ZipKey', () => {
      // Sin esta guarda `accepted >= count` sería `0 >= 0` y mandaría las notas
      // contra facturas que nunca salieron.
      const d = decide({ invoice_zip_key_count: 0, accepted: 0, poll: 1 });
      expect(d.action).toBe('defer_notes');
      expect(d.reason).toContain('Ninguna factura obtuvo ZipKey');
    });

    it('difiere también con un recuento negativo', () => {
      expect(decide({ invoice_zip_key_count: -1 }).action).toBe('defer_notes');
    });
  });

  it('respeta un tope inyectado, para que la espera sea probable sin esperar', () => {
    expect(decide({ accepted: 0, poll: 3, max_polls: 3 }).action).toBe(
      'defer_notes',
    );
    expect(decide({ accepted: 0, poll: 2, max_polls: 3 }).action).toBe(
      'keep_waiting',
    );
  });

  it('concuerda el singular y el plural del recuento de consultas', () => {
    expect(decide({ accepted: 5, poll: 1 }).reason).toContain('1 consulta.');
    expect(decide({ accepted: 5, poll: 2 }).reason).toContain('2 consultas.');
  });
});
