/**
 * Contrato tipado del job asíncrono del set de pruebas DIAN
 * (cola BullMQ `dian-test-set`).
 *
 * POR QUÉ EXISTE — el defecto que cierra:
 *
 * `POST .../test-set` era sincrónico y tardaba ~107 s: reservaba numeración,
 * construía 50 UBL, los firmaba con XAdES, comprimía y subía el ZIP a la DIAN, y
 * encima sondeaba `GetStatusZip` seis veces en línea. El `location /` de nginx en
 * producción no declara `proxy_read_timeout`, así que hereda el default de 60 s:
 * los dos envíos del 2026-08-05 devolvieron **504** al navegador mientras el
 * backend los completaba sin problema.
 *
 * La consecuencia era peor que una espera fea. El handler de éxito del frontend
 * nunca corría, así que la UI se quedaba mostrando el estado de ANTES del envío,
 * y el toast de error afirmaba «No se pudo enviar el set de pruebas» — falso: el
 * set sí se envió y quemó 50 consecutivos autorizados. Un mensaje así invita a
 * reenviar y quemar otros 50 que no se recuperan.
 *
 * El sondeo en línea además nunca podía servir: `SendTestSetAsync` es asíncrono
 * precisamente porque la DIAN no emite veredicto en la misma conexión.
 *
 * Este contrato es module-local A PROPÓSITO — no debe filtrarse al contrato
 * compartido `ai-engine/queue/interfaces/ai-queue.interface.ts`.
 */
export interface DianTestSetJob {
  /** Configuración fiscal contra la que se emite el lote. */
  config_id: number;
  /** Resolución de habilitación que aporta la numeración. */
  resolution_id: number;
  /**
   * Consulta el veredicto del lote ya enviado (`GetStatusZip`) y NO emite nada.
   *
   * Corta antes de reservar numeración. Permite resolver el veredicto de un set en
   * validación sin pasar por la UI ni gastar un consecutivo.
   */
  check_status?: boolean;
  /**
   * Consulta a la DIAN los rangos autorizados y NO emite nada.
   *
   * Corta antes de reservar numeración: cuesta cero consecutivos. Es la vía para
   * dejar de transcribir del portal los datos de la resolución.
   */
  numbering_range?: boolean;
  /**
   * Vía de humo: emite UNA factura y gasta UN consecutivo, en vez de la
   * composición completa que exige la DIAN.
   *
   * Existe porque el consecutivo autorizado es finito e irrecuperable y el único
   * juez de la ingesta es el contador del portal de habilitación. HIDRO gastó 150
   * en tres lotes de 50 sin que la DIAN recibiera un documento. Con esto la
   * pregunta «¿la DIAN ingiere lo que enviamos?» cuesta 1 número, no 50.
   *
   * NO habilita: un documento suelto no es un set válido.
   */
  smoke?: boolean;
  /**
   * Vía de validación: emite el MISMO documento que el set de pruebas y lo somete
   * a `SendBillSync` en vez de `SendTestSetAsync`.
   *
   * Existe porque un ZipKey no distingue «tu documento está bien y está en cola»
   * de «tu documento nunca se clasificó», y esa ambigüedad dejó el diagnóstico en
   * manos del contador del portal de habilitación durante un mes. `SendBillSync`
   * es sincrónica: la DIAN contesta en la misma llamada con `IsValid` y la lista
   * completa de reglas violadas, cada una con su código.
   *
   * No lleva `testSetId`: no puede rechazar el set ni consumir un intento de
   * habilitación. Implica la composición de 1 documento, igual que `smoke`.
   */
  validate_only?: boolean;
  /**
   * Snapshot del contexto tomado al encolar. El worker lo restaura con
   * `RequestContextService.run(...)` porque `StorePrismaService` lee el scope de
   * AsyncLocalStorage, que NO existe naturalmente dentro de un worker de BullMQ.
   *
   * `store_id` es opcional y puede ser `undefined` legítimamente: la plataforma
   * corre este mismo flujo sin tienda porque su identidad fiscal es la
   * organización (ver `SubscriptionFiscalService.runInPlatformContext`).
   */
  context: {
    store_id?: number;
    organization_id?: number;
    user_id?: number;
    is_super_admin?: boolean;
    is_owner?: boolean;
    request_id?: string;
  };
}

/** Estados del ciclo de vida de BullMQ que se exponen al cliente que sondea. */
export type DianTestSetJobState =
  | 'waiting'
  | 'active'
  | 'completed'
  | 'failed'
  | 'delayed';

/**
 * Respuesta del endpoint de sondeo del job.
 *
 * `result` solo viene con `status === 'completed'` y es el MISMO objeto que
 * devolvía el endpoint sincrónico, para que el frontend no tenga que aprender
 * una forma nueva. `error` solo viene con `status === 'failed'`.
 */
export interface DianTestSetJobStatusResult {
  status: DianTestSetJobState;
  result?: unknown;
  error?: string;
}
