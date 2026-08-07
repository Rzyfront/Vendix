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
 * Lo que se fija acá es la REGLA DE AGREGACIÓN: un rechazo gana sobre lo
 * pendiente, y el éxito exige que TODOS resuelvan.
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

  it('un solo rechazo entre 50 rechaza el lote completo, aunque falten por resolver', () => {
    const all = keys(50);
    // 20 aceptados, 1 rechazado, 29 sin veredicto todavía.
    const verdicts = byKey([
      ...all.slice(0, 20).map(accepted),
      rejected('zip-37'),
    ]);

    const result = aggregateZipVerdicts(all, verdicts);

    expect(result.rejected).toBe(true);
    expect(result.pending).toBe(false);
    expect(result.success).toBe(false);
    // El primary apunta al RECHAZO: es lo que el operador necesita leer.
    expect(result.primary_key).toBe('zip-37');
    expect(result.counts).toEqual({
      total: 50,
      resolved: 21,
      rejected: 1,
      accepted: 20,
      pending: 29,
    });
  });

  it('sigue pendiente mientras quede uno sin veredicto y no haya rechazos', () => {
    const all = keys(50);
    const verdicts = byKey(all.slice(0, 49).map(accepted));

    const result = aggregateZipVerdicts(all, verdicts);

    expect(result.pending).toBe(true);
    expect(result.success).toBe(false);
    expect(result.rejected).toBe(false);
    expect(result.primary_key).toBeNull();
    expect(result.counts.pending).toBe(1);
  });

  it('aprueba solo cuando los 50 resolvieron con éxito', () => {
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

  it('un lote de un solo ZipKey se comporta igual que antes del cambio', () => {
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
    expect(result.rejected).toBe(false);
    expect(result.pending).toBe(true);
  });

  it('no declara éxito sobre un lote sin ZipKeys', () => {
    // Sin la guarda de `total > 0`, `resolved === total` sería `0 === 0` y esto
    // devolvería un set aprobado sin que se haya enviado nada.
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
