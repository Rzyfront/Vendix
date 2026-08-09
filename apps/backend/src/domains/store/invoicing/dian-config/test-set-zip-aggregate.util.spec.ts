import {
  TestSetZipVerdict,
  aggregateZipVerdicts,
} from './test-set-zip-aggregate.util';

/**
 * Estos casos existen por un defecto de producción, no por cobertura.
 *
 * El lote de habilitación de la plataforma (config 15, 7-ago-2026) salió como 50
 * ZIP independientes y la DIAN devolvió 50 ZipKeys, guardados todos en
 * `last_test_result.zip_keys`. Pero `checkTestSetStatus` leía `previous.zip_key`
 * —el PRIMERO— y sondeaba solo ese. Los otros 49 veredictos eran inalcanzables
 * por construcción: el cron de re-sondeo estuvo 8 h preguntando por el documento
 * 1 mientras el portal mostraba Recibidos 0, y nadie podía saber si la DIAN había
 * rechazado el 37.
 *
 * Lo que se fija acá es la REGLA DE AGREGACIÓN, y CAMBIÓ el 9-ago-2026 porque la
 * DIAN falseó su premisa. Decía «un rechazo gana sobre lo pendiente, y el éxito
 * exige que TODOS resuelvan», con el argumento de que la DIAN exige la composición
 * completa. No es así: aprobó el set de la plataforma —«Su empresa ha superado
 * satisfactoriamente las pruebas de validación»— con 30 facturas aceptadas y 167
 * documentos rechazados acumulados.
 *
 * El criterio real es el «Total de documentos aceptados requeridos» del portal:
 * 1 documento, 1 factura, 0 notas. Por eso el éxito se decide por el MÍNIMO
 * ACEPTADO y el rechazo solo cuando ya no queda nada por resolver.
 */
describe('aggregateZipVerdicts', () => {
  const RESOLVED_AT = '2026-08-07T12:00:00.000Z';

  const accepted = (zip_key: string): TestSetZipVerdict => ({
    zip_key,
    success: true,
    status_code: '00',
    status_message: 'Procesado correctamente.',
    error_messages: [],
    resolved_at: RESOLVED_AT,
  });

  const rejected = (zip_key: string): TestSetZipVerdict => ({
    zip_key,
    success: false,
    status_code: '99',
    status_message: 'Documento rechazado.',
    error_messages: ['Regla: FAB24a, Rechazo: No se encuentra informado...'],
    resolved_at: RESOLVED_AT,
  });

  const keys = (n: number) => Array.from({ length: n }, (_, i) => `zip-${i}`);

  const byKey = (list: TestSetZipVerdict[]) =>
    list.reduce<Record<string, TestSetZipVerdict>>((acc, v) => {
      acc[v.zip_key] = v;
      return acc;
    }, {});

  it('APRUEBA con rechazos si se alcanzó el mínimo aceptado — el caso real', () => {
    const all = keys(50);
    // El lote real de la plataforma: 30 aceptadas, 20 rechazadas, 0 pendientes.
    // El portal lo declaró superado. La regla anterior lo daba por rechazado y
    // bloqueaba una habilitación ya ganada.
    const verdicts = byKey([
      ...all.slice(0, 30).map(accepted),
      ...all.slice(30, 50).map(rejected),
    ]);

    const result = aggregateZipVerdicts(all, verdicts);

    expect(result.success).toBe(true);
    expect(result.rejected).toBe(false);
    expect(result.pending).toBe(false);
    expect(result.counts).toEqual({
      total: 50,
      resolved: 50,
      rejected: 20,
      accepted: 30,
      pending: 0,
    });
  });

  it('declara éxito EN CUANTO se alcanza el mínimo, sin esperar al resto', () => {
    const all = keys(50);
    // Una aceptada y 49 sin veredicto: la DIAN ya no puede quitar esa aceptación,
    // así que esperar solo alarga una espera cuyo resultado está decidido.
    const result = aggregateZipVerdicts(all, byKey([accepted('zip-0')]));

    expect(result.success).toBe(true);
    expect(result.pending).toBe(false);
    expect(result.primary_key).toBe('zip-0');
    expect(result.counts.pending).toBe(49);
  });

  it('RECHAZA solo cuando todo resolvió y el mínimo no se alcanzó', () => {
    const all = keys(50);
    const result = aggregateZipVerdicts(all, byKey(all.map(rejected)));

    expect(result.rejected).toBe(true);
    expect(result.success).toBe(false);
    expect(result.pending).toBe(false);
    expect(result.primary_key).toBe('zip-0');
  });

  it('sigue pendiente mientras no se alcance el mínimo y falte por resolver', () => {
    const all = keys(50);
    // 20 rechazadas, ninguna aceptada, 30 sin veredicto: todavía puede aprobar.
    const result = aggregateZipVerdicts(
      all,
      byKey(all.slice(0, 20).map(rejected)),
    );

    expect(result.pending).toBe(true);
    expect(result.success).toBe(false);
    expect(result.rejected).toBe(false);
  });

  it('respeta un mínimo distinto del predeterminado', () => {
    const all = keys(50);
    const verdicts = byKey(all.slice(0, 3).map(accepted));

    expect(aggregateZipVerdicts(all, verdicts, 3).success).toBe(true);
    expect(aggregateZipVerdicts(all, verdicts, 4).success).toBe(false);
  });

  it('aprueba cuando los 50 resolvieron con éxito', () => {
    const all = keys(50);

    const result = aggregateZipVerdicts(all, byKey(all.map(accepted)));

    expect(result.success).toBe(true);
    expect(result.pending).toBe(false);
    expect(result.rejected).toBe(false);
    expect(result.primary_key).toBe('zip-0');
    expect(result.counts).toEqual({
      total: 50,
      resolved: 50,
      rejected: 0,
      accepted: 50,
      pending: 0,
    });
  });

  it('un lote de un solo ZipKey: aceptado aprueba, rechazado rechaza', () => {
    expect(aggregateZipVerdicts(['solo'], {}).pending).toBe(true);
    expect(aggregateZipVerdicts(['solo'], byKey([accepted('solo')])).success).toBe(
      true,
    );
    expect(
      aggregateZipVerdicts(['solo'], byKey([rejected('solo')])).rejected,
    ).toBe(true);
  });

  it('ignora veredictos huérfanos que no pertenecen al lote vigente', () => {
    // `zip_verdicts` es acumulativo en el JSON, así que puede arrastrar claves de
    // un lote anterior. Contarlas declararía resuelto un lote que no lo está.
    const result = aggregateZipVerdicts(
      ['zip-a', 'zip-b'],
      byKey([accepted('zip-a'), accepted('viejo-1'), rejected('viejo-2')]),
    );

    expect(result.counts.total).toBe(2);
    expect(result.counts.resolved).toBe(1);
    // `zip-a` está aceptada, así que con mínimo 1 el lote ya aprueba. Lo que este
    // caso fija es que los huérfanos NO entran en el recuento: sin la guarda,
    // `resolved` sería 3 sobre un total de 2.
    expect(result.success).toBe(true);
    expect(result.rejected).toBe(false);
  });

  it('no declara éxito sobre un lote sin ZipKeys', () => {
    // Sin la guarda de `total > 0`, un lote vacío con mínimo 0 devolvería un set
    // aprobado sin que se haya enviado nada.
    const result = aggregateZipVerdicts([], {});

    expect(result.success).toBe(false);
    expect(result.pending).toBe(true);
    expect(result.counts.total).toBe(0);
  });

  it('no cuenta dos veces un ZipKey repetido en la lista', () => {
    const result = aggregateZipVerdicts(
      ['zip-a', 'zip-a', 'zip-b'],
      byKey([accepted('zip-a'), accepted('zip-b')]),
    );

    expect(result.counts.total).toBe(2);
    expect(result.success).toBe(true);
  });
});
