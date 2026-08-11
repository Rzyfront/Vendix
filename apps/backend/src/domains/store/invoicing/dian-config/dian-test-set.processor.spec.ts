import { DianTestSetProcessor } from './dian-test-set.processor';

/**
 * Clave donde `@nestjs/bullmq` guarda las `WorkerOptions` del decorador
 * `@Processor(name, opts)`. Se escribe literal porque el paquete NO la exporta
 * desde su raíz (`WORKER_METADATA` vive en `dist/bull.constants`, sin re-export).
 * Si una versión futura la cambia, este spec falla — que es exactamente lo que
 * queremos: mejor enterarse por un test que por un lote duplicado en la DIAN.
 */
const WORKER_METADATA = 'bullmq:worker_metadata';

/**
 * ESTE SPEC PROTEGE 50 CONSECUTIVOS AUTORIZADOS IRRECUPERABLES.
 *
 * `attempts: 1` en el productor NO basta. En BullMQ la recuperación de un job
 * ESTANCADO es un mecanismo APARTE del contador de intentos: sus propios tipos
 * describen `maxStalledCount` (default 1) como «Amount of times a job can be
 * recovered from a stalled state to the `wait` state». Un job cuyo lock caduca
 * vuelve a la cola y se procesa otra vez, sin consultar `attempts`.
 *
 * Caducar el lock no es hipotético: pasa cuando el contenedor se reinicia a mitad
 * del job, que es lo que hace un deploy. Con el default, un deploy durante un envío
 * haría que `executeTestSet` corriera de nuevo, reservara OTRO bloque de 50
 * consecutivos y mandara un segundo lote a la DIAN. En silencio.
 *
 * El envío en dos fases agravó la exposición: el job pasó de ~2 minutos a hasta ~12.
 */
describe('DianTestSetProcessor — opciones del worker', () => {
  const worker_options = Reflect.getMetadata(
    WORKER_METADATA,
    DianTestSetProcessor,
  );

  it('declara opciones de worker — sin ellas el default de BullMQ manda', () => {
    // Si el segundo argumento de `@Processor` desaparece, el decorador no escribe
    // este metadato y el worker hereda `maxStalledCount: 1`.
    expect(worker_options).toBeDefined();
  });

  it('prohíbe la recuperación de un job estancado (maxStalledCount = 0)', () => {
    expect(worker_options.maxStalledCount).toBe(0);
  });

  it('es 0 exacto, no un valor falsy cualquiera', () => {
    // `undefined` también es falsy y significaría el default 1. La distinción no es
    // pedante: es la diferencia entre fallar y duplicar un lote.
    expect(worker_options.maxStalledCount).not.toBeUndefined();
    expect(typeof worker_options.maxStalledCount).toBe('number');
  });

  /**
   * QUI-674 — el otro lado de la misma moneda.
   *
   * `maxStalledCount: 0` convierte un lock caducado en un `failed`. Eso es lo
   * correcto cuando el proceso murió, y una regresión cara cuando el worker está
   * vivo y solo estaba bloqueando el event loop: el envío a la DIAN se aborta a
   * media corrida con los consecutivos ya reservados.
   *
   * BullMQ renueva el lock a la MITAD de `lockDuration` (15 s con el default de
   * 30 s) y esa renovación es un temporizador de ESTE event loop. Si el job no lo
   * cede, no corre. Con la firma ya troceada (caché del PKCS#12 + cesión por
   * documento) el macrotask más largo es sub-segundo, y `lockDuration` se
   * dimensiona con margen sobre esa cota.
   */
  it('declara un lockDuration explícito, no el default de 30 s de BullMQ', () => {
    expect(worker_options.lockDuration).not.toBeUndefined();
    expect(typeof worker_options.lockDuration).toBe('number');
    expect(worker_options.lockDuration).toBe(120_000);
  });

  it('deja margen real sobre el default: al menos 60 s', () => {
    // Sin esta cota inferior, alguien podría "limpiar" el 120_000 de vuelta a un
    // valor cercano al default y el spec anterior seguiría siendo el único
    // testigo. El umbral describe la INTENCIÓN (margen amplio), no el número.
    expect(worker_options.lockDuration).toBeGreaterThanOrEqual(60_000);
  });

  /**
   * TRIPWIRE — el spec original solo miraba `maxStalledCount`, así que CUALQUIER
   * opción nueva del decorador entraba a producción sin un solo test que la
   * nombrara. Este assert obliga a que añadir una opción sea una decisión
   * consciente: si aparece o desaparece una clave, este test falla y hay que
   * escribir aquí por qué existe.
   */
  it('el juego de opciones del worker es exactamente el declarado', () => {
    expect(Object.keys(worker_options).sort()).toEqual([
      'lockDuration',
      'maxStalledCount',
    ]);
  });
});
