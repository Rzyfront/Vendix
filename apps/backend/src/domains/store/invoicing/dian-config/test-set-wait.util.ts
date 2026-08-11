/**
 * Reading of how long a DIAN habilitación batch has been waiting for a verdict.
 *
 * `SendTestSetAsync` only acknowledges receipt; the verdict comes from polling
 * `GetStatusZip`. When DIAN keeps answering "Batch en proceso de validación" the
 * batch is indistinguishable from one it silently dropped — and a UI that only
 * knows `pending: true` renders that as an unbounded wait with no way out.
 *
 * This module turns the stored `last_test_result` into a bounded state with an
 * explicit set of next actions, so "still processing" eventually becomes
 * "stalled — here is what to do" instead of a spinner forever.
 *
 * Pure on purpose: the HTTP services and the re-poll cron job must agree on the
 * verdict, and a shared pure function is the only way to guarantee that.
 */

/**
 * DIAN judges a habilitación batch in minutes, not days. Past this window,
 * waiting is no longer a strategy: the batch needs per-document diagnosis or a
 * re-send. Deliberately generous so a slow DIAN afternoon does not raise a
 * false alarm.
 */
export const TEST_SET_STALL_AFTER_MS = 6 * 60 * 60 * 1000;

/**
 * Devuelve el lote que PRUEBA la habilitación, que no siempre es el último.
 *
 * EL DEFECTO QUE CIERRA — ocurrió en producción el 2026-08-09
 *
 * `last_test_result` cumple DOS papeles incompatibles: es el puntero al lote en
 * vuelo y es la prueba de que la DIAN aprobó el set. Cinco superficies leen de él
 * el estado de la habilitación (`analyzeTestSetWait` en el panel fiscal y en el
 * cron, `hasPassedTestSet` en la readiness y en el gate de promoción, y el
 * endpoint de estado), así que un lote posterior lo sobrescribe y con él la
 * prueba.
 *
 * Pasó exactamente así: la plataforma quedó habilitada a las 05:59Z; a las 18:53Z
 * un reenvío accidental escribió su propio resultado —rechazado, porque la DIAN
 * cierra el set al aprobarlo— y a las 19:41Z descartar ese lote dejó
 * `enablement_status` en `testing`. La UI pasó a decir «habilitación pendiente»
 * sobre una configuración que la DIAN había habilitado catorce horas antes.
 *
 * La prueba durable existe y sobrevivió: `enablement_evidence` se escribe SOLO en
 * éxito y `enabled_at` guarda el instante que la DIAN concedió. Esta función las
 * antepone al último lote, para que un intento posterior pueda fallar, ser
 * descartado o quedar a medias sin borrar un hecho ya ocurrido.
 *
 * Pura, como el resto de este archivo: las cinco superficies tienen que coincidir
 * en la respuesta, y una función compartida sin E/S es la única forma de
 * garantizarlo.
 *
 * LOS TRES CAMPOS SON OBLIGATORIOS, Y ESO ES LA MITAD DEL ARREGLO
 *
 * La primera versión los declaró opcionales. Con eso, un `select` de Prisma que
 * no pidiera `enablement_evidence` typecheaba limpio, la función recibía
 * `undefined`, `looksLikeVerdict` devolvía `false` y caía al último lote — el
 * comportamiento exacto que esta función existe para evitar. Pasó en
 * `getTestResults`, que seleccionaba cinco columnas y no esa: el arreglo quedó
 * inerte en esa ruta durante todo su despliegue.
 *
 * Obligatorios, un `select` incompleto no compila. Es el mismo criterio que
 * `SharedTechnicalKeyFinding` ya aplica en `fiscal-production-readiness`: «un
 * campo opcional ausente se leería como “sin hallazgo” y la comprobación fallaría
 * en abierto». Aquí el fallo en abierto es leer «no pasó» sobre una habilitación
 * concedida.
 */
export function resolveTestSetProof(config: {
  enablement_status: string | null;
  enablement_evidence: unknown;
  last_test_result: unknown;
}): unknown {
  const passed =
    config.enablement_status === 'test_set_passed' ||
    config.enablement_status === 'enabled';

  // La evidencia manda cuando el estado dice que el set pasó. Fuera de ese caso
  // se devuelve el último lote tal cual: durante la habilitación el lote en vuelo
  // ES la única fuente, y anteponer una evidencia vieja escondería el intento en
  // curso.
  //
  // PERO SOLO SI LA EVIDENCIA ES UN VEREDICTO, no cualquier objeto no vacío.
  //
  // `enablement_evidence` se escribe con el `result_data` completo del lote que
  // pasó, así que lleva `dian_response.success` o `success`. Hay configuraciones
  // —y fixtures— cuya evidencia es un resto sin veredicto (`{ track_id }`), y
  // anteponerla haría LO CONTRARIO de lo que esta función busca: leer «no pasó»
  // sobre una habilitación real, perdiendo el respaldo del último lote. La primera
  // versión de esto rompió cinco casos del spec de readiness por exactamente eso,
  // y el spec tenía razón.
  if (passed && looksLikeVerdict(config.enablement_evidence)) {
    return config.enablement_evidence;
  }
  return config.last_test_result;
}

/**
 * La lectura de la espera SOBRE LA PRUEBA CORRECTA, en un solo paso.
 *
 * POR QUÉ EXISTE ESTA COMPOSICIÓN Y NO CUATRO COPIAS DE ELLA
 *
 * `analyzeTestSetWait(resolveTestSetProof(config))` estaba escrito a mano en
 * cuatro superficies, y en dos de ellas faltaba la mitad de dentro: el sondeo del
 * asistente y la salida del lote descartado llamaban a `analyzeTestSetWait` a
 * secas. Una composición correcta pero opcional es una composición que alguien va
 * a olvidar; ya se olvidó dos veces.
 *
 * A partir de acá, quien necesite el estado de la espera llama a ESTO. Llamar a
 * `analyzeTestSetWait` directo sigue siendo válido —el cron lo usa sobre un
 * registro que ya trae resuelto— pero deja de ser el camino por defecto.
 */
export function resolveTestSetWait(
  config: {
    enablement_status: string | null;
    enablement_evidence: unknown;
    last_test_result: unknown;
  },
  now: number = Date.now(),
): TestSetWaitAnalysis {
  return analyzeTestSetWait(resolveTestSetProof(config), now);
}

/** ¿Este registro lleva un veredicto de la DIAN, o es solo un objeto cualquiera? */
function looksLikeVerdict(record: unknown): boolean {
  if (!record || typeof record !== 'object') return false;
  const data = record as Record<string, any>;
  return (
    typeof data.success === 'boolean' ||
    typeof data?.dian_response?.success === 'boolean'
  );
}

export type TestSetWaitState =
  | 'idle'
  | 'processing'
  | 'stalled'
  | 'passed'
  | 'rejected'
  | 'abandoned';

export type TestSetNextAction =
  | 'run_test_set'
  | 'recheck'
  | 'diagnose_documents'
  | 'abandon_and_resend';

export interface TestSetWaitAnalysis {
  state: TestSetWaitState;
  /** Milliseconds since DIAN acknowledged the batch, when known. */
  waiting_ms: number | null;
  stalled: boolean;
  /**
   * Whether the batch can still be diagnosed document by document. False for
   * batches submitted before per-document keys were persisted: for those,
   * `GetStatus`-by-CUFE is impossible and re-sending is the only way forward.
   */
  diagnosable: boolean;
  /** Human-readable why, already in Spanish; null when there is nothing to explain. */
  reason: string | null;
  next_actions: TestSetNextAction[];
}

const HOUR_MS = 60 * 60 * 1000;

function hoursLabel(ms: number): string {
  const hours = Math.floor(ms / HOUR_MS);
  if (hours < 1) return 'menos de una hora';
  if (hours < 24) return `${hours} hora${hours === 1 ? '' : 's'}`;
  const days = Math.floor(hours / 24);
  return `${days} día${days === 1 ? '' : 's'}`;
}

/**
 * @param last_test_result the raw `dian_configurations.last_test_result` JSON
 * @param now injectable clock so the analysis is testable
 */
export function analyzeTestSetWait(
  last_test_result: unknown,
  now: number = Date.now(),
): TestSetWaitAnalysis {
  const result = (last_test_result ?? {}) as Record<string, any>;
  const documents = Array.isArray(result.documents) ? result.documents : [];
  const diagnosable = documents.length > 0;

  // El descarte se evalúa ANTES de exigir un `zip_key`, y antes que `pending`.
  //
  // POR QUÉ EL ORDEN IMPORTA: `abandonTestSet` borra `zip_key` precisamente para
  // que ningún sondeo pueda resucitar el lote, así que la clave solo sobrevive en
  // `abandoned_batches`. Y mientras `checkTestSetStatus` pudo reescribir
  // `pending: true` sobre un lote ya descartado, la única defensa era que esta
  // rama se evaluara primero. Un tenant real quedó 51 h con `abandoned: true` y
  // `pending: true` a la vez, con la UI ofreciéndole reenviar y el backend
  // negándoselo con DIAN_TEST_SET_002.
  if (result.abandoned === true) {
    const abandoned_batches = Array.isArray(result.abandoned_batches)
      ? result.abandoned_batches
      : [];
    const key: string | null =
      result.zip_key ??
      abandoned_batches[abandoned_batches.length - 1]?.zip_key ??
      null;

    return {
      state: 'abandoned',
      waiting_ms: null,
      stalled: false,
      // Un lote descartado no se diagnostica: la DIAN no va a emitir veredicto
      // sobre él y sus documentos ya no representan el estado de la habilitación.
      //
      // OJO: esto NO significa que falten las claves de documento. La UI mostraba
      // «este lote se envió antes de que se guardaran las claves de documento»
      // para cualquier `diagnosable: false`, y en un lote descartado con sus 50
      // CUFE guardados eso era una mentira. Por eso esta rama trae su propio
      // `reason`: la UI debe explicar el estado con este texto, no inventarlo.
      diagnosable: false,
      reason: key
        ? `El lote ${key} se descartó sin veredicto de la DIAN. Puedes ejecutar un set de pruebas nuevo.`
        : 'El último lote se descartó sin veredicto de la DIAN. Puedes ejecutar un set de pruebas nuevo.',
      next_actions: ['run_test_set'],
    };
  }

  const zipKey: string | null = result.zip_key ?? null;

  if (!zipKey) {
    return {
      state: 'idle',
      waiting_ms: null,
      stalled: false,
      diagnosable: false,
      reason: null,
      next_actions: ['run_test_set'],
    };
  }

  if (result.pending !== true) {
    if (result.rejected === true) {
      return {
        state: 'rejected',
        waiting_ms: null,
        stalled: false,
        diagnosable,
        reason:
          result.dian_response?.status_message ??
          'La DIAN rechazó el set de pruebas.',
        next_actions: ['abandon_and_resend'],
      };
    }
    return {
      state: 'passed',
      waiting_ms: null,
      stalled: false,
      diagnosable,
      reason: null,
      next_actions: [],
    };
  }

  // Measured from the submission, not from the last re-poll: what matters is how
  // long DIAN has held the batch, and re-polling must not reset that clock —
  // otherwise a user who keeps pressing "consultar" never reaches `stalled`.
  const submittedAt = result.executed_at
    ? new Date(result.executed_at).getTime()
    : NaN;
  const waiting_ms = Number.isFinite(submittedAt) ? now - submittedAt : null;
  const stalled =
    waiting_ms !== null && waiting_ms >= TEST_SET_STALL_AFTER_MS;

  if (!stalled) {
    return {
      state: 'processing',
      waiting_ms,
      stalled: false,
      diagnosable,
      reason: `La DIAN recibió el lote ${zipKey} y aún lo está validando.`,
      next_actions: ['recheck'],
    };
  }

  const waited = waiting_ms === null ? 'un tiempo prolongado' : hoursLabel(waiting_ms);

  return {
    state: 'stalled',
    waiting_ms,
    stalled: true,
    diagnosable,
    reason: diagnosable
      ? `La DIAN recibió el lote ${zipKey} hace ${waited} y no ha emitido veredicto. Consulta documento por documento para saber si los registró; si no los registró, descarta el lote y reenvía.`
      : `La DIAN recibió el lote ${zipKey} hace ${waited} y no ha emitido veredicto. Este lote se envió antes de que se guardaran las claves de documento, así que no se puede consultar por CUFE: descártalo y reenvía el set.`,
    next_actions: diagnosable
      ? ['diagnose_documents', 'abandon_and_resend']
      : ['abandon_and_resend'],
  };
}
