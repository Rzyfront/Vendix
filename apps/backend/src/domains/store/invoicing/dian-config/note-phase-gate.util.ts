/**
 * Puerta del envío en DOS FASES del set de pruebas: ¿pueden salir ya las notas?
 *
 * POR QUÉ EXISTE
 *
 * El set enviaba sus 50 documentos de corrido, así que cada nota llegaba a
 * validación en el mismo minuto que la factura a la que apunta. La DIAN rechazó
 * las 20 notas del lote de habilitación con la misma frase:
 *
 *   CBG04a  «documento referenciado no existe en los registros de la DIAN»
 *   DBG04a  idem, para la nota débito
 *
 * No era un defecto del documento: el `BillingReference` llevaba el número, el
 * CUFE y la fecha correctos. Era el ORDEN. Y era una excepción que el propio
 * sistema se hacía a sí mismo: la emisión real ya exige que la factura
 * referenciada esté `accepted` antes de permitir su nota
 * (`invoice-flow.service.ts`). Solo el generador del set se la saltaba.
 *
 * PURA A PROPÓSITO, por la misma razón que `test-set-wait.util.ts`: la decisión
 * de si una nota puede salir gasta consecutivos autorizados irrecuperables si se
 * toma mal, y verificarla no debe exigir montar el servicio de 2.200 líneas ni
 * hablar con la DIAN. Aquí vive la regla; el servicio solo aporta el sondeo.
 */

/**
 * Tope de espera entre fases: 20 sondeos × 30 s = 10 minutos.
 *
 * Medido: la DIAN clasificó el lote de 50 del 2026-08-09 en ese orden de
 * magnitud. La espera corre dentro del worker de BullMQ —que renueva su lock
 * mientras el proceso vive—, así que no choca con el `proxy_read_timeout` de
 * nginx que en su día devolvía 504 sobre este mismo envío. Ese es justamente el
 * motivo por el que el set se movió a una cola.
 */
export const NOTE_PHASE_MAX_POLLS = 20;
export const NOTE_PHASE_POLL_DELAY_MS = 30_000;

/**
 * ¿Puede una corrida del set escribir `enablement_status`, o hacerlo degradaría
 * una habilitación ya ganada?
 *
 * EL DEFECTO QUE CIERRA
 *
 * `executeTestSet` escribe `enablement_status: 'testing'` antes de enviar y
 * `'test_set_passed' | 'testing'` al terminar. Ninguna de las dos ramas vuelve
 * nunca a `enabled`. La plataforma quedó `enabled` el 2026-08-09 tras aprobar su
 * set —la DIAN por correo: «actualmente se encuentra en estado habilitado»—, así
 * que reenviar el set para probar las notas la habría degradado a `testing` y de
 * ahí, con suerte, a `test_set_passed`. Nunca de vuelta.
 *
 * Eso no es cosmético: `hasPassedTestSetPublic` y el gate de promoción a
 * producción leen este campo. Un reenvío legítimo —justo el del paso siguiente de
 * este trabajo— habría tirado el estado que costó semanas conseguir, y la DIAN no
 * lo devuelve: lo devuelve su portal, a mano.
 *
 * `enabled` es TERMINAL y lo declara la DIAN, no nosotros. Un set posterior puede
 * añadir evidencia, nunca quitar la habilitación.
 */
export function canWriteEnablementStatus(
  current: string | null | undefined,
): boolean {
  return current !== 'enabled';
}

/** Factura que la DIAN YA tiene registrada, apta para que una nota la referencie. */
export interface RegisteredInvoiceReference {
  number: string;
  cufe: string;
  date: string;
}

/**
 * Facturas de un lote anterior que la DIAN ACEPTÓ, y por tanto tiene en sus
 * registros.
 *
 * PARA QUÉ SIRVE
 *
 * Diagnosticar una nota necesita una factura que exista del lado de la DIAN. Sin
 * esto, un humo de nota débito arrastraría CBG04a/DBG04a —«documento referenciado
 * no existe»— y el diagnóstico no distinguiría entre «la nota está mal armada» y
 * «la factura a la que apunta no ha nacido». Ese es justo el ruido que hizo falta
 * un mes para separar la primera vez.
 *
 * Referenciar una factura YA aceptada convierte el humo en una medición limpia: si
 * la DIAN sigue objetando, la objeción es del documento.
 *
 * LA ACEPTACIÓN SE CRUZA, NO SE SUPONE. `documents[]` dice qué se envió, y no si
 * la DIAN lo aceptó: la aceptación vive en `zip_verdicts`, indexada por ZipKey, y
 * el puente entre ambos es `submissions[].file_name`. Leer `documents` a secas
 * devolvería también las rechazadas, que es el error que este cruce evita.
 */
export function resolveRegisteredInvoiceReferences(
  last_test_result: unknown,
): RegisteredInvoiceReference[] {
  const result = (last_test_result ?? {}) as Record<string, any>;
  const documents = Array.isArray(result.documents) ? result.documents : [];
  const submissions = Array.isArray(result.submissions)
    ? result.submissions
    : [];
  const verdicts = (result.zip_verdicts ?? {}) as Record<string, any>;

  const zip_key_by_file = new Map<string, string>();
  for (const s of submissions) {
    if (s?.file_name && s?.zip_key) zip_key_by_file.set(s.file_name, s.zip_key);
  }

  const accepted: RegisteredInvoiceReference[] = [];
  for (const doc of documents) {
    if (doc?.kind !== 'invoice') continue;
    if (!doc.number || !doc.cufe || !doc.issue_date) continue;
    const zip_key = zip_key_by_file.get(doc.file_name);
    if (!zip_key) continue;
    if (verdicts[zip_key]?.success !== true) continue;
    accepted.push({
      number: doc.number,
      cufe: doc.cufe,
      date: doc.issue_date,
    });
  }
  return accepted;
}

export type NotePhaseAction = 'send_notes' | 'keep_waiting' | 'defer_notes';

export interface NotePhaseDecision {
  action: NotePhaseAction;
  /** Por qué, en español y listo para persistir y mostrar. */
  reason: string;
}

/**
 * Decide si la fase 2 puede transmitirse, debe seguir esperando, o se difiere.
 *
 * LA PUERTA ES «TODAS ACEPTADAS», NO «AL MENOS UNA».
 *
 * `aggregateZipVerdicts` usa por defecto `DIAN_TEST_SET_MIN_ACCEPTED_DOCUMENTS`
 * (1), que es el criterio de APROBACIÓN DEL SET publicado por el portal. Ese no
 * es el criterio de aquí: esto no decide si el set aprueba, decide si el
 * documento siguiente puede existir. Una nota apunta a UNA factura concreta, y si
 * esa factura no está registrada la DIAN la rechaza por mucho que otras 29 sí lo
 * estén. Confundir los dos criterios es lo que haría pasar por «listo» un lote
 * que va a rechazar 20 documentos.
 *
 * Se exige el total —y no solo las facturas efectivamente referenciadas— porque
 * el XML de la nota ya está FIRMADO con su referencia: reapuntarlo a otra factura
 * exigiría volver a firmar y cambiaría el CUDE. Filtrar «manda solo las notas
 * cuya factura fue aceptada» sería más fino y requiere persistir por archivo a
 * qué factura apunta cada nota; solo cambia el resultado en un set que ya viene
 * fallando y que el operador tiene que mirar de todos modos.
 *
 * `defer_notes` NUNCA significa «descarta las notas». Significa que quedan
 * generadas, firmadas y sin transmitir, con su consecutivo reservado: el llamador
 * debe persistirlas. Transmitirlas contra facturas que la DIAN no registró sería
 * gastar 20 números autorizados para cosechar los mismos CBG04a/DBG04a.
 */
export function decideNotePhase(params: {
  /** Cuántas facturas de la fase 1 obtuvieron ZipKey. */
  invoice_zip_key_count: number;
  /** Facturas con veredicto de aceptación. */
  accepted: number;
  /** Facturas con veredicto de rechazo. */
  rejected: number;
  /** Sondeo actual, empezando en 1. */
  poll: number;
  max_polls?: number;
}): NotePhaseDecision {
  const {
    invoice_zip_key_count,
    accepted,
    rejected,
    poll,
    max_polls = NOTE_PHASE_MAX_POLLS,
  } = params;

  // Sin ZipKey no hay nada que la DIAN pueda haber registrado. Esta guarda va
  // primera porque sin ella `accepted === count` sería `0 === 0` y mandaría las
  // notas contra facturas que nunca salieron.
  if (invoice_zip_key_count <= 0) {
    return {
      action: 'defer_notes',
      reason:
        'Ninguna factura obtuvo ZipKey, así que no hay nada que la DIAN pueda registrar. Las notas no se transmiten.',
    };
  }

  // Un rechazo corta la espera de inmediato: seguir sondeando no lo va a
  // convertir en aceptación, y cada sondeo extra retrasa el diagnóstico.
  if (rejected > 0) {
    return {
      action: 'defer_notes',
      reason:
        `La DIAN rechazó ${rejected} de ${invoice_zip_key_count} facturas. ` +
        'Las notas no se transmiten: referencian facturas que no quedaron registradas.',
    };
  }

  if (accepted >= invoice_zip_key_count) {
    return {
      action: 'send_notes',
      reason: `Las ${accepted} facturas quedaron registradas en la DIAN tras ${poll} consultas.`,
    };
  }

  if (poll >= max_polls) {
    return {
      action: 'defer_notes',
      reason:
        `Tope de espera agotado: tras ${max_polls} consultas la DIAN había registrado ` +
        `${accepted} de ${invoice_zip_key_count} facturas. Las notas quedan generadas y sin transmitir.`,
    };
  }

  return {
    action: 'keep_waiting',
    reason:
      `${accepted} de ${invoice_zip_key_count} facturas registradas tras ${poll} ` +
      `consulta${poll === 1 ? '' : 's'}.`,
  };
}
