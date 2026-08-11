import {
  TEST_SET_STALL_AFTER_MS,
  analyzeTestSetWait,
  resolveTestSetProof,
  resolveTestSetWait,
} from './test-set-wait.util';

/**
 * ESTE RESOLVEDOR EXISTE PORQUE SU AUSENCIA BORRÓ UNA HABILITACIÓN EN LA UI.
 *
 * `last_test_result` cumple dos papeles incompatibles: puntero al lote en vuelo y
 * prueba de que la DIAN aprobó el set. El 2026-08-09 la plataforma quedó habilitada
 * a las 05:59Z, un reenvío accidental sobrescribió el registro a las 18:53Z, y
 * descartar ese lote a las 19:41Z dejó la UI diciendo «habilitación pendiente».
 */
describe('resolveTestSetProof', () => {
  const evidence = { zip_key: 'aprobado', dian_response: { success: true } };
  const latest = { zip_key: 'fallido', rejected: true, abandoned: true };

  it('antepone la evidencia durable cuando la config está habilitada', () => {
    expect(
      resolveTestSetProof({
        enablement_status: 'enabled',
        enablement_evidence: evidence,
        last_test_result: latest,
      }),
    ).toBe(evidence);
  });

  it('la antepone también con el set aprobado pero aún sin habilitar', () => {
    expect(
      resolveTestSetProof({
        enablement_status: 'test_set_passed',
        enablement_evidence: evidence,
        last_test_result: latest,
      }),
    ).toBe(evidence);
  });

  it('DURANTE la habilitación devuelve el último lote — es la única fuente', () => {
    // Anteponer una evidencia vieja aquí esconderÍa el intento en curso, que es
    // justo lo que el operador necesita ver.
    for (const status of ['not_started', 'testing', 'rejected']) {
      expect(
        resolveTestSetProof({
          enablement_status: status,
          enablement_evidence: evidence,
          last_test_result: latest,
        }),
      ).toBe(latest);
    }
  });

  it('cae al último lote si la evidencia falta, aun estando habilitada', () => {
    // Configuraciones habilitadas antes de que `enablement_evidence` existiera.
    expect(
      resolveTestSetProof({
        enablement_status: 'enabled',
        enablement_evidence: null,
        last_test_result: latest,
      }),
    ).toBe(latest);
  });

  /**
   * Una evidencia SIN veredicto no puede anteponerse: haría lo contrario de lo que
   * esta función busca — leer «no pasó» sobre una habilitación real, perdiendo el
   * respaldo del último lote. La primera versión de este resolvedor rompió cinco
   * casos del spec de readiness por eso, y el spec tenía razón.
   */
  it('ignora una evidencia que no lleva veredicto', () => {
    const stub = { track_id: 'track-1' };
    expect(
      resolveTestSetProof({
        enablement_status: 'enabled',
        enablement_evidence: stub,
        last_test_result: { success: true },
      }),
    ).toEqual({ success: true });
  });

  it('acepta la evidencia con veredicto en cualquiera de sus dos formas', () => {
    const plano = { success: true };
    const anidado = { dian_response: { success: true } };
    for (const ev of [plano, anidado]) {
      expect(
        resolveTestSetProof({
          enablement_status: 'enabled',
          enablement_evidence: ev,
          last_test_result: latest,
        }),
      ).toBe(ev);
    }
  });

  it('antepone también una evidencia que registra un veredicto NEGATIVO', () => {
    // `success: false` sigue siendo un veredicto: si el estado dice que el set
    // pasó y la evidencia dice lo contrario, esa contradicción debe ser visible,
    // no taparse con el último lote.
    const negativa = { success: false, zip_key: 'raro' };
    expect(
      resolveTestSetProof({
        enablement_status: 'enabled',
        enablement_evidence: negativa,
        last_test_result: latest,
      }),
    ).toBe(negativa);
  });

  it('un lote descartado ya no puede tapar una habilitación concedida', () => {
    // El caso exacto del 2026-08-09: `abandoned: true` hacía que
    // `analyzeTestSetWait` devolviera «descartado, ejecuta un set nuevo».
    const proof = resolveTestSetProof({
      enablement_status: 'enabled',
      enablement_evidence: evidence,
      last_test_result: { abandoned: true, zip_key: null },
    });
    expect(proof).toBe(evidence);
  });
});

/**
 * ESTA COMPOSICIÓN ES LA QUE CUATRO SUPERFICIES CONSUMEN, Y DOS LA HACÍAN MAL.
 *
 * `analyzeTestSetWait(resolveTestSetProof(config))` estaba escrito a mano en
 * cuatro sitios. En dos —el sondeo del asistente cada 15 s y la salida del lote
 * descartado— faltaba la mitad de dentro: llamaban a `analyzeTestSetWait` a secas
 * sobre `last_test_result`. El resultado era una configuración `enabled`
 * respondiendo `wait.state: 'abandoned'`, con la insignia diciendo «Habilitado» y
 * la tarjeta de espera ofreciendo ejecutar un set nuevo.
 *
 * Los casos de abajo prueban la composición, no sus mitades: cada mitad ya tiene
 * los suyos, y las dos estaban bien por separado. Lo que falló fue juntarlas.
 */
describe('resolveTestSetWait', () => {
  const NOW = new Date('2026-08-09T20:00:00.000Z').getTime();

  /** La evidencia que la DIAN dejó el 2026-08-09 a las 05:59Z. */
  const evidence = {
    zip_key: 'e2d19623-aprobado',
    dian_response: { success: true },
  };

  /** El lote de las 18:53Z, rechazado y descartado a las 19:41Z. */
  const discarded = {
    zip_key: null,
    abandoned: true,
    pending: false,
    rejected: true,
    abandoned_batches: [{ zip_key: '16bea3b2-rechazado' }],
  };

  it('una habilitación concedida NO se lee como lote descartado', () => {
    const wait = resolveTestSetWait(
      {
        enablement_status: 'enabled',
        enablement_evidence: evidence,
        last_test_result: discarded,
      },
      NOW,
    );

    // Antes daba 'abandoned' con next_actions ['run_test_set']: la UI le pedía
    // rehacer la habilitación a una configuración que la DIAN ya había habilitado.
    expect(wait.state).toBe('passed');
    expect(wait.next_actions).toEqual([]);
  });

  it('vale igual con el set aprobado y la producción todavía sin habilitar', () => {
    const wait = resolveTestSetWait(
      {
        enablement_status: 'test_set_passed',
        enablement_evidence: evidence,
        last_test_result: discarded,
      },
      NOW,
    );
    expect(wait.state).toBe('passed');
  });

  it('DURANTE la habilitación describe el lote en vuelo, no una evidencia vieja', () => {
    const wait = resolveTestSetWait(
      {
        enablement_status: 'testing',
        enablement_evidence: evidence,
        last_test_result: {
          zip_key: 'en-vuelo',
          pending: true,
          executed_at: new Date(NOW - 60_000).toISOString(),
          documents: [{ cufe: 'c1', number: 'SETP1' }],
        },
      },
      NOW,
    );

    // Esconder el intento en curso detrás de una evidencia anterior sería el
    // defecto opuesto, y es el que el operador necesita ver.
    expect(wait.state).toBe('processing');
    expect(wait.reason).toContain('en-vuelo');
  });

  it('respeta el reloj inyectado, así que el estancamiento es medible', () => {
    const executed_at = new Date(NOW - TEST_SET_STALL_AFTER_MS - 1).toISOString();
    const wait = resolveTestSetWait(
      {
        enablement_status: 'testing',
        enablement_evidence: null,
        last_test_result: {
          zip_key: 'viejo',
          pending: true,
          executed_at,
          documents: [{ cufe: 'c1', number: 'SETP1' }],
        },
      },
      NOW,
    );
    expect(wait.state).toBe('stalled');
  });

  it('sin evidencia se comporta exactamente como la composición manual', () => {
    // Garantiza que extraer la composición no cambió nada para las dos
    // superficies que ya la hacían bien.
    const config = {
      enablement_status: 'enabled' as string | null,
      enablement_evidence: null as unknown,
      last_test_result: discarded as unknown,
    };
    expect(resolveTestSetWait(config, NOW)).toEqual(
      analyzeTestSetWait(resolveTestSetProof(config), NOW),
    );
  });
});

/**
 * Estos casos existen por un bug de producción, no por cobertura.
 *
 * Un tenant real (HIDRO INSTALACIONES) quedó 51 h con `abandoned: true` y
 * `pending: true` a la vez: al descartar el lote, `abandonTestSet` dejaba
 * `pending: false`, y el sondeo del wizard —cada 15 s— llamaba a
 * `checkTestSetStatus`, que reescribía `pending: true` en cuanto la DIAN repetía
 * «Batch en proceso de validación». El descarte se deshacía solo.
 *
 * Como las guardas de reenvío miran `pending`, el resultado era un candado sin
 * salida: la UI ofrecía ejecutar un set nuevo y el backend contestaba
 * DIAN_TEST_SET_002. Y como la rama `abandoned` devuelve `diagnosable: false`,
 * la UI imprimía «este lote se envió antes de que se guardaran las claves de
 * documento» sobre un lote que tenía sus 50 CUFE guardados.
 *
 * Lo que se fija acá es el ORDEN de evaluación: el descarte gana sobre `pending`
 * y no depende de que `zip_key` siga presente.
 */
describe('analyzeTestSetWait', () => {
  const NOW = new Date('2026-08-06T00:20:00.000Z').getTime();
  const SUBMITTED = '2026-08-03T20:59:03.221Z';
  const ZIP_KEY = '932bceac-eaae-4c12-a9e6-8e51c3e13a84';

  const documents = Array.from({ length: 50 }, (_, i) => ({
    cufe: `cufe-${i}`,
    number: `SETP99000000${i}`,
  }));

  it('trata un lote descartado como descartado aunque un sondeo haya reescrito pending', () => {
    const wait = analyzeTestSetWait(
      {
        zip_key: ZIP_KEY,
        executed_at: SUBMITTED,
        // La combinación imposible que existía en producción.
        abandoned: true,
        pending: true,
        documents,
        abandoned_batches: [{ zip_key: ZIP_KEY }],
      },
      NOW,
    );

    expect(wait.state).toBe('abandoned');
    expect(wait.stalled).toBe(false);
    expect(wait.next_actions).toEqual(['run_test_set']);
  });

  it('reconoce el descarte cuando abandonTestSet ya borró zip_key', () => {
    const wait = analyzeTestSetWait(
      {
        // Sin `zip_key`: es lo que deja el descarte, para que ningún sondeo
        // pueda resucitar el lote.
        executed_at: SUBMITTED,
        abandoned: true,
        pending: false,
        documents,
        abandoned_batches: [{ zip_key: ZIP_KEY }],
      },
      NOW,
    );

    expect(wait.state).toBe('abandoned');
    expect(wait.next_actions).toEqual(['run_test_set']);
    // La clave se recupera del historial: sin esto el estado degradaba a `idle`
    // y el usuario perdía todo rastro de qué lote había descartado.
    expect(wait.reason).toContain(ZIP_KEY);
  });

  it('explica el descarte por el descarte, no por claves de documento faltantes', () => {
    const wait = analyzeTestSetWait(
      { zip_key: ZIP_KEY, executed_at: SUBMITTED, abandoned: true, documents },
      NOW,
    );

    // `diagnosable: false` es correcto —un lote descartado no se diagnostica—
    // pero la razón NO puede ser que falten las claves: acá hay 50.
    expect(wait.diagnosable).toBe(false);
    expect(wait.reason).toContain('descartó');
    expect(wait.reason).not.toContain('claves de documento');
  });

  it('sin lote no hay nada que esperar', () => {
    const wait = analyzeTestSetWait({}, NOW);
    expect(wait.state).toBe('idle');
    expect(wait.next_actions).toEqual(['run_test_set']);
  });

  it('un lote reciente sigue en proceso y solo admite volver a consultar', () => {
    const wait = analyzeTestSetWait(
      {
        zip_key: ZIP_KEY,
        pending: true,
        executed_at: new Date(NOW - 60_000).toISOString(),
        documents,
      },
      NOW,
    );

    expect(wait.state).toBe('processing');
    expect(wait.stalled).toBe(false);
    expect(wait.next_actions).toEqual(['recheck']);
  });

  it('pasado el umbral se declara estancado y ofrece diagnosticar o reenviar', () => {
    const wait = analyzeTestSetWait(
      {
        zip_key: ZIP_KEY,
        pending: true,
        executed_at: new Date(NOW - TEST_SET_STALL_AFTER_MS - 1).toISOString(),
        documents,
      },
      NOW,
    );

    expect(wait.state).toBe('stalled');
    expect(wait.stalled).toBe(true);
    expect(wait.diagnosable).toBe(true);
    expect(wait.next_actions).toEqual([
      'diagnose_documents',
      'abandon_and_resend',
    ]);
  });

  it('un lote estancado sin claves guardadas solo admite reenviar', () => {
    const wait = analyzeTestSetWait(
      {
        zip_key: ZIP_KEY,
        pending: true,
        executed_at: new Date(NOW - TEST_SET_STALL_AFTER_MS - 1).toISOString(),
        // Envío anterior a que se persistieran las claves por documento.
        documents: [],
      },
      NOW,
    );

    expect(wait.diagnosable).toBe(false);
    expect(wait.next_actions).toEqual(['abandon_and_resend']);
    // Acá SÍ corresponde el mensaje que la UI usaba para todo.
    expect(wait.reason).toContain('claves de documento');
  });

  it('el reloj de la espera cuenta desde el envío, no desde el último sondeo', () => {
    const executed_at = new Date(NOW - TEST_SET_STALL_AFTER_MS - 1).toISOString();
    const wait = analyzeTestSetWait(
      {
        zip_key: ZIP_KEY,
        pending: true,
        executed_at,
        // Sondeado hace un segundo: si el reloj se reiniciara con cada consulta,
        // quien insiste en «volver a consultar» nunca llegaría a `stalled`.
        rechecked_at: new Date(NOW - 1_000).toISOString(),
        documents,
      },
      NOW,
    );

    expect(wait.state).toBe('stalled');
  });
});
