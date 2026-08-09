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
});
