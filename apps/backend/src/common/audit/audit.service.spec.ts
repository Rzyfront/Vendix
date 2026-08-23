import { AuditService, AuditAction, AuditResource } from './audit.service';
import { RequestContextService } from '@common/context/request-context.service';
import type { RequestContext } from '@common/context/request-context.service';

/**
 * CP-PURCHASE-TRANSPARENCY H.1 — `audit_logs.request_id`.
 *
 * La columna existe desde `20260822180000_purchase_transparency_additive_schema`,
 * pero nadie la escribía: 0 de 33.590 filas la tenían, mientras un comentario en
 * `http-exception.filter.ts` afirmaba que «the audit log on the server side
 * already carries it». Esta suite fija que ahora sí se persiste, y —más
 * importante— fija las TRES condiciones en las que debe quedar NULL, porque un
 * token de correlación equivocado es peor que ninguno: correlaciona eventos que
 * no ocurrieron juntos.
 */
describe('AuditService — request_id de correlación', () => {
  let service: AuditService;
  let create: jest.Mock;

  const baseContext = (overrides: Partial<RequestContext> = {}): RequestContext => ({
    is_super_admin: false,
    is_owner: false,
    ...overrides,
  });

  const logOnce = () =>
    service.log({
      userId: 15,
      action: AuditAction.UPDATE,
      resource: AuditResource.PRODUCTS,
      resourceId: 7,
    });

  /** Los datos con los que se llamó a `audit_logs.create`. */
  const writtenData = () => create.mock.calls[0][0].data;

  beforeEach(() => {
    create = jest.fn().mockResolvedValue({ id: 1 });
    service = new AuditService({ audit_logs: { create } } as any);
    // El estático `currentContext` sobrevive entre tests porque vive en la
    // clase; se limpia para que cada caso parta de un estado conocido.
    (RequestContextService as any).currentContext = undefined;
  });

  afterEach(() => {
    (RequestContextService as any).currentContext = undefined;
  });

  it('persiste el request_id del contexto ALS de la petición', async () => {
    await RequestContextService.asyncLocalStorage.run(
      baseContext({ request_id: 'e2b1c0de-1111-4222-8333-444455556666' }),
      logOnce,
    );

    expect(writtenData().request_id).toBe(
      'e2b1c0de-1111-4222-8333-444455556666',
    );
  });

  it('acepta un X-Request-Id entrante que no es UUID (el interceptor lo hereda tal cual)', async () => {
    // `request-context.interceptor.ts:41-45` honra el header del caller
    // verbatim. Por eso la columna es TEXTO y no `uuid`.
    await RequestContextService.asyncLocalStorage.run(
      baseContext({ request_id: 'gateway-trace/9f2a::retry-1' }),
      logOnce,
    );

    expect(writtenData().request_id).toBe('gateway-trace/9f2a::retry-1');
  });

  it('deja NULL cuando no hay contexto de request (job suelto, listener fuera del ALS)', async () => {
    await logOnce();

    expect(writtenData().request_id).toBeNull();
  });

  /**
   * El caso que obliga a leer el ALS directo y NO
   * `RequestContextService.getRequestId()`.
   *
   * `getContext()` cae de vuelta al estático `currentContext` que deja
   * `RequestContextService.run()`. Los processors de BullMQ y los cron forjan
   * contexto con ese `run()` —`accounting-entry-retry.processor.ts:54` incluso
   * fabrica `accounting-retry-<id>`—, así que después de que uno corra, el
   * estático queda cargado. Si la auditoría leyera por ahí, una escritura fuera
   * del ALS heredaría el id de un job que jamás la produjo.
   */
  it('NO hereda el request_id rancio que un job dejó en el estático currentContext', async () => {
    RequestContextService.run(
      baseContext({ request_id: 'accounting-retry-4821', organization_id: 3 }),
      () => undefined,
    );

    // Fuera de todo scope ALS, como un listener que corre tras la respuesta.
    await logOnce();

    expect(writtenData().request_id).toBeNull();
    // Prueba de que el estático SÍ está cargado: si la auditoría leyera por
    // `getContext()`, el caso de arriba habría escrito 'accounting-retry-4821'.
    expect(RequestContextService.getRequestId()).toBe('accounting-retry-4821');
  });

  it('un job que restauró contexto con run() sí aporta su request_id legítimo', async () => {
    await RequestContextService.run(
      baseContext({ request_id: 'queue-receipt-scan-77' }),
      logOnce,
    );

    expect(writtenData().request_id).toBe('queue-receipt-scan-77');
  });

  /**
   * `audit_logs.request_id` es `VARCHAR(100)` y el interceptor acepta el header
   * entrante sin validarlo. Si el valor viajara al INSERT, Postgres rechazaría
   * la fila y el `catch` de `log()` se lo tragaría: se perdería TODA la entrada
   * de auditoría, no solo el identificador.
   *
   * Se descarta, no se trunca: un token truncado es un token inventado y dos
   * peticiones con el mismo prefijo colisionarían en una correlación falsa.
   */
  it('descarta (no trunca) un request_id que no cabe en VARCHAR(100), y aún así escribe la fila', async () => {
    const oversized = 'x'.repeat(101);

    await RequestContextService.asyncLocalStorage.run(
      baseContext({ request_id: oversized }),
      logOnce,
    );

    expect(create).toHaveBeenCalledTimes(1);
    expect(writtenData().request_id).toBeNull();
  });

  it('conserva un request_id de exactamente 100 caracteres', async () => {
    const exact = 'y'.repeat(100);

    await RequestContextService.asyncLocalStorage.run(
      baseContext({ request_id: exact }),
      logOnce,
    );

    expect(writtenData().request_id).toBe(exact);
  });
});
