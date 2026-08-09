import {
  canWriteEnablementStatus,
  decideNotePhase,
  isTestSetClosedByDian,
  resolveRegisteredInvoiceReferences,
  NOTE_PHASE_MAX_POLLS,
} from './note-phase-gate.util';

/**
 * ESTE PREDICADO EXISTE PORQUE SU AUSENCIA COSTÓ 30 CONSECUTIVOS.
 *
 * La DIAN no acepta documentos contra un set que ya aprobó: responde status 2 con
 * «Set de prueba … se encuentra Aceptado» a cada uno. Medido el 2026-08-09 sobre
 * la plataforma — 30 facturas enviadas, 30 rechazadas con esa frase, y los
 * documentos estaban bien (el humo sincrónico del mismo código dio `is_valid`).
 */
describe('isTestSetClosedByDian', () => {
  it('considera cerrado un set aprobado y una config habilitada', () => {
    // `test_set_passed` es nuestra lectura del veredicto; `enabled` es el hecho que
    // la DIAN reporta. Si el set pasó, la DIAN lo cerró: el orden entre los dos no
    // cambia la consecuencia.
    expect(isTestSetClosedByDian('test_set_passed')).toBe(true);
    expect(isTestSetClosedByDian('enabled')).toBe(true);
  });

  it('deja pasar los estados en los que el set sigue abierto', () => {
    for (const state of ['not_started', 'testing', 'rejected']) {
      expect(isTestSetClosedByDian(state)).toBe(false);
    }
  });

  it('deja pasar un estado ausente', () => {
    // Una config sin estado no ha aprobado nada, así que su set sigue abierto.
    expect(isTestSetClosedByDian(null)).toBe(false);
    expect(isTestSetClosedByDian(undefined)).toBe(false);
  });

  /**
   * `rejected` NO cierra el set: un set rechazado es exactamente el caso en que hay
   * que corregir y reenviar. Bloquearlo dejaría al tenant sin salida.
   */
  it('un set RECHAZADO sigue abierto — es el caso que necesita reenviar', () => {
    expect(isTestSetClosedByDian('rejected')).toBe(false);
  });
});

/**
 * Diagnosticar una nota necesita una factura que exista DEL LADO DE LA DIAN. Si
 * se elige una rechazada, el humo arrastra CBG04a/DBG04a y vuelve a mezclar las
 * dos causas que costó un mes separar: «la nota está mal armada» y «la factura a
 * la que apunta no ha nacido».
 */
describe('resolveRegisteredInvoiceReferences', () => {
  /** Lote con 3 facturas y 1 nota: dos facturas aceptadas, una rechazada. */
  const batch = {
    documents: [
      { number: 'SETP1', cufe: 'a'.repeat(96), kind: 'invoice', file_name: 'f1.xml', issue_date: '2026-08-08' },
      { number: 'SETP2', cufe: 'b'.repeat(96), kind: 'invoice', file_name: 'f2.xml', issue_date: '2026-08-08' },
      { number: 'SETP3', cufe: 'c'.repeat(96), kind: 'invoice', file_name: 'f3.xml', issue_date: '2026-08-08' },
      { number: 'SETP4', cufe: 'd'.repeat(96), kind: 'debit_note', file_name: 'f4.xml', issue_date: '2026-08-08' },
    ],
    submissions: [
      { file_name: 'f1.xml', zip_key: 'zip-1' },
      { file_name: 'f2.xml', zip_key: 'zip-2' },
      { file_name: 'f3.xml', zip_key: 'zip-3' },
      { file_name: 'f4.xml', zip_key: 'zip-4' },
    ],
    zip_verdicts: {
      'zip-1': { success: true },
      'zip-2': { success: false },
      'zip-3': { success: true },
      'zip-4': { success: true },
    },
  };

  it('devuelve solo las facturas que la DIAN aceptó', () => {
    const refs = resolveRegisteredInvoiceReferences(batch);
    expect(refs.map((r) => r.number)).toEqual(['SETP1', 'SETP3']);
  });

  it('excluye la factura rechazada — leer documents a secas la incluiría', () => {
    // SETP2 se envió y tiene ZipKey, así que aparece en `documents`. Lo que la
    // descalifica es su veredicto, que vive en otro sitio.
    const refs = resolveRegisteredInvoiceReferences(batch);
    expect(refs.map((r) => r.number)).not.toContain('SETP2');
  });

  it('excluye las notas: una nota no puede referenciar otra nota', () => {
    const refs = resolveRegisteredInvoiceReferences(batch);
    expect(refs.map((r) => r.number)).not.toContain('SETP4');
  });

  it('devuelve número, CUFE y fecha — los tres que exige BillingReference', () => {
    const [first] = resolveRegisteredInvoiceReferences(batch);
    expect(first).toEqual({
      number: 'SETP1',
      cufe: 'a'.repeat(96),
      date: '2026-08-08',
    });
  });

  it('excluye una factura sin veredicto todavía', () => {
    const refs = resolveRegisteredInvoiceReferences({
      ...batch,
      zip_verdicts: { 'zip-1': { success: true } },
    });
    expect(refs.map((r) => r.number)).toEqual(['SETP1']);
  });

  it('excluye una factura cuyo envío no obtuvo ZipKey', () => {
    const refs = resolveRegisteredInvoiceReferences({
      ...batch,
      submissions: [{ file_name: 'f1.xml', zip_key: null }],
    });
    expect(refs).toEqual([]);
  });

  it('devuelve vacío sobre un lote ausente o vacío, sin lanzar', () => {
    // El llamador convierte el vacío en un error con instrucciones; esta función
    // no decide, solo informa.
    expect(resolveRegisteredInvoiceReferences(null)).toEqual([]);
    expect(resolveRegisteredInvoiceReferences({})).toEqual([]);
    expect(resolveRegisteredInvoiceReferences({ documents: 'no-es-lista' })).toEqual([]);
  });
});

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
