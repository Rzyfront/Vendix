import { DIAN_TEST_SET_MIN_ACCEPTED_DOCUMENTS } from './dian-test-set-composition';

/**
 * Agregación del veredicto de un lote de habilitación repartido en N ZipKeys.
 *
 * Un envío de 50 documentos no sale como un ZIP: sale como 50 ZIP
 * independientes, y la DIAN devuelve un ZipKey por cada uno (el Anexo 1.9 §7.9
 * lo permite: «El servicio puede recibir un ZIP con uno o todos los documentos
 * asociados al Set de Prueba»). Cada ZipKey se resuelve por su cuenta, así que
 * «¿cómo va el lote?» no tiene respuesta hasta que alguien combina las N.
 *
 * Pura a propósito, por la misma razón que `test-set-wait.util.ts`: el endpoint
 * HTTP y el cron de re-sondeo tienen que coincidir en el veredicto, y una
 * función compartida sin E/S es la única forma de garantizarlo. Además es lo que
 * hace verificable la regla de agregación sin levantar el grafo de dependencias
 * del servicio.
 */

/**
 * Veredicto TERMINAL de un ZipKey, persistido en
 * `last_test_result.zip_verdicts` para no volver a preguntarlo.
 *
 * Solo se guardan los terminales: un «en proceso» no es una respuesta, es la
 * ausencia de una, y persistirlo haría que el lote pareciera resuelto.
 */
export interface TestSetZipVerdict {
  zip_key: string;
  success: boolean;
  status_code: string;
  status_message: string;
  error_messages: string[];
  resolved_at: string;
  /**
   * El XML con el que la DIAN emitió ESTE veredicto, acotado.
   *
   * POR QUÉ — el defecto que cierra:
   *
   * La DIAN rechazó 30 de 30 facturas de HIDRO (config 12) y el sistema guardó
   * el conteo. El motivo por documento vive en el `ApplicationResponse` que
   * viaja en base64 dentro de `<b:XmlBase64Bytes>`, y ese bloque se descartaba
   * al construir el veredicto: `error_messages` recoge lo que la DIAN pone en
   * `<b:ErrorMessage>`, que puede venir vacío mientras el ApplicationResponse
   * sí trae la regla violada. Sin el crudo no hay fallback y el diagnóstico
   * exige volver a preguntarle a la DIAN por un lote que ya contestó.
   *
   * Opcional porque los veredictos persistidos ANTES de este campo siguen en el
   * JSON y deben seguir leyéndose. Acotado a `MAX_RAW_RESPONSE_CHARS` por la
   * misma razón que `dian_response.raw_response`: es evidencia, no un archivo.
   */
  raw_response?: string;
  /**
   * Reglas de rechazo DECODIFICADAS del `ApplicationResponse`.
   *
   * Las produce `DianResponseParserService.parseApplicationResponse`, que ya
   * sabía extraerlas (`Regla: XXXX, Rechazo: …`, `cbc:Description`) y nunca se
   * invocaba desde el set de pruebas. Es la diferencia entre «la DIAN rechazó»
   * y «la DIAN rechazó por FAB24a».
   */
  rejection_rules?: DianRejectionRule[];
  /** CUFE/CUDE que el `ApplicationResponse` nombra, cuando lo nombra. */
  document_key?: string;
}

/**
 * Una regla de validación que la DIAN reportó, ya decodificada.
 *
 * Se declara aquí —y no se importa de `interfaces/dian-response.interface`—
 * porque este módulo es PURO y es el que define la forma persistida en
 * `last_test_result.zip_verdicts`. Es estructuralmente compatible con
 * `DianValidationError`, así que asignar uno al otro compila sin adaptador.
 */
export interface DianRejectionRule {
  code: string;
  message: string;
  severity: 'error' | 'warning';
}

/**
 * Tope de evidencia cruda que se persiste por veredicto.
 *
 * Mismo valor que ya usaban `dian_response.raw_response` en las dos escrituras
 * del servicio. Se nombra aquí para que las tres dejen de repetir el literal y
 * no puedan divergir.
 */
export const MAX_RAW_RESPONSE_CHARS = 12_000;

/**
 * Recuento del lote multi-ZipKey. Viaja al llamador para que la UI pueda decir
 * «43 de 50 resueltos, 2 rechazados» en vez de un «en proceso» que no distingue
 * entre «la DIAN no ha contestado» y «no le hemos preguntado».
 */
export interface TestSetZipCounts {
  total: number;
  resolved: number;
  rejected: number;
  accepted: number;
  pending: number;
}

export interface TestSetZipAggregate {
  counts: TestSetZipCounts;
  /**
   * ZipKey cuyo veredicto representa al lote, o `null` si ninguno resolvió aún.
   *
   * Prioriza el primer RECHAZO: es lo que el operador necesita leer, y un lote
   * con un rechazo ya no puede aprobarse por mucho que los demás acepten.
   */
  primary_key: string | null;
  success: boolean;
  pending: boolean;
  rejected: boolean;
}

/**
 * Combina los veredictos conocidos de un lote en un estado único.
 *
 * REGLA DE AGREGACIÓN — la decide el MÍNIMO ACEPTADO, no la ausencia de rechazos:
 *
 *   · aceptados >= mínimo                  ⇒ APROBADO
 *   · todos resueltos y aceptados < mínimo ⇒ RECHAZADO
 *   · en cualquier otro caso               ⇒ PENDIENTE
 *
 * ⚠️ ESTO CORRIGE UNA REGLA ANTERIOR QUE BLOQUEÓ UNA HABILITACIÓN YA GANADA.
 *
 * Decía «cualquier ZipKey terminal sin éxito ⇒ RECHAZADO», con el razonamiento de
 * que «la DIAN exige la composición completa del set, así que un documento
 * rechazado invalida el lote entero». La DIAN falseó esa premisa: aprobó el set de
 * la plataforma —«Su empresa ha superado satisfactoriamente las pruebas de
 * validación»— con 30 facturas aceptadas y 167 documentos rechazados acumulados.
 *
 * Su criterio real es el de «Total de documentos aceptados requeridos» del portal:
 * 1 documento, 1 factura electrónica, 0 notas. Ver
 * `DIAN_TEST_SET_MIN_ACCEPTED_DOCUMENTS`.
 *
 * El éxito se declara EN CUANTO se alcanza el mínimo, sin esperar a que el resto
 * resuelva: es lo que hace la DIAN, y esperar de más alarga una espera cuyo
 * resultado ya está decidido — el mismo argumento de la regla anterior, aplicado
 * al criterio correcto.
 *
 * `zip_keys` manda sobre `verdicts`: un veredicto huérfano (de un lote anterior
 * que quedó en el JSON) no cuenta, y un ZipKey sin veredicto cuenta como
 * pendiente. Así el recuento siempre describe el lote vigente.
 */
export function aggregateZipVerdicts(
  zip_keys: string[],
  verdicts: Record<string, TestSetZipVerdict>,
  min_accepted: number = DIAN_TEST_SET_MIN_ACCEPTED_DOCUMENTS,
): TestSetZipAggregate {
  const unique = Array.from(
    new Set(zip_keys.filter((k) => typeof k === 'string' && k.length > 0)),
  );

  const resolved = unique.filter((k) => !!verdicts[k]);
  const rejected_keys = resolved.filter((k) => !verdicts[k].success);
  const accepted_keys = resolved.filter((k) => verdicts[k].success);

  const counts: TestSetZipCounts = {
    total: unique.length,
    resolved: resolved.length,
    rejected: rejected_keys.length,
    accepted: accepted_keys.length,
    pending: unique.length - resolved.length,
  };

  // Un lote sin ZipKeys no está aprobado: no hay nada que aprobar. Sin esta
  // guarda `accepted >= 1` sobre un lote vacío devolvería éxito sobre la nada.
  const success = counts.total > 0 && counts.accepted >= min_accepted;
  const all_resolved = counts.total > 0 && counts.resolved === counts.total;
  // Rechazado solo cuando ya no queda nada por resolver y el mínimo no se alcanzó.
  const rejected = !success && all_resolved;
  const pending = !success && !all_resolved;

  return {
    counts,
    primary_key: success
      ? accepted_keys[0]
      : rejected
        ? rejected_keys[0]
        : (rejected_keys[0] ?? null),
    success,
    pending,
    rejected,
  };
}

/** El documento que viajó dentro de un ZipKey concreto. */
export interface TestSetDocumentRef {
  zip_key: string;
  /** Número con prefijo de resolución, p. ej. `SETP990000230`. */
  number: string;
  /** `invoice` | `debit_note` | `credit_note`. */
  kind: string;
  file_name: string;
  cufe?: string;
}

/**
 * ZipKey → documento, cruzando `submissions[].file_name` con `documents[].file_name`.
 *
 * POR QUÉ EXISTE — el defecto que cierra:
 *
 * Un veredicto está indexado por ZipKey y un ZipKey no dice nada de qué
 * documento contenía. Por eso el log agregado del lote solo podía imprimir
 * «rechazados=30»: tenía los veredictos delante y ninguna forma de nombrar el
 * documento de cada uno. Con este cruce, «30 rechazadas» pasa a ser «SETP990000200
 * (invoice): Regla FAB24a…», que es lo que un operador puede accionar.
 *
 * `resolveRegisteredInvoiceReferences` (`note-phase-gate.util.ts`) hace este mismo
 * puente para el lado ACEPTADO, porque su pregunta es «¿a qué factura puede
 * apuntar una nota?». Esta función es la del lado RECHAZADO y devuelve todos los
 * documentos con ZipKey, sin filtrar por veredicto: quien la usa ya sabe qué
 * veredicto está mirando.
 *
 * Tolerante con la forma a propósito: `last_test_result` es JSON en base y puede
 * venir de un envío anterior a que `documents[]` o `submissions[]` existieran.
 * Un lote viejo devuelve `{}`, que es exactamente «no se puede nombrar».
 */
export function indexDocumentsByZipKey(
  last_test_result: unknown,
): Record<string, TestSetDocumentRef> {
  const result = (last_test_result ?? {}) as Record<string, any>;
  const documents = Array.isArray(result.documents) ? result.documents : [];
  const submissions = Array.isArray(result.submissions)
    ? result.submissions
    : [];

  const zip_key_by_file = new Map<string, string>();
  for (const s of submissions) {
    if (s?.file_name && s?.zip_key) zip_key_by_file.set(s.file_name, s.zip_key);
  }

  const index: Record<string, TestSetDocumentRef> = {};
  for (const doc of documents) {
    if (!doc?.file_name) continue;
    const zip_key = zip_key_by_file.get(doc.file_name);
    if (!zip_key) continue;
    index[zip_key] = {
      zip_key,
      number: typeof doc.number === 'string' ? doc.number : '',
      kind: typeof doc.kind === 'string' ? doc.kind : 'unknown',
      file_name: doc.file_name,
      ...(typeof doc.cufe === 'string' && doc.cufe ? { cufe: doc.cufe } : {}),
    };
  }
  return index;
}

/**
 * Las reglas de un veredicto en UNA lista, con el crudo como último recurso.
 *
 * Prioriza lo decodificado (`rejection_rules`) sobre lo que la DIAN puso en
 * `<b:ErrorMessage>` (`error_messages`) porque el primero trae el código de
 * regla y el segundo a veces viene vacío aun habiendo rechazo — que es
 * exactamente el caso que dejaba el motivo fuera del registro.
 */
export function rejectionMessages(verdict: TestSetZipVerdict): string[] {
  const decoded = (verdict.rejection_rules ?? []).map((r) =>
    r.code && r.code !== 'DIAN_VALIDATION'
      ? `${r.code}: ${r.message}`
      : r.message,
  );
  const reported = verdict.error_messages ?? [];
  // Sin duplicar: el parser también recoge de `cbc:Description` lo que la DIAN
  // pudo haber repetido en `ErrorMessage`.
  const seen = new Set(decoded);
  return [...decoded, ...reported.filter((m) => !seen.has(m))];
}

/**
 * Una línea por documento RECHAZADO, lista para el log y para el mensaje de
 * auditoría.
 *
 * `limit` acota lo que va al log: 30 rechazos con 4 reglas cada uno son 120
 * líneas que nadie lee y que el registro por documento ya guarda entero en
 * `dian_audit_logs`. El log es el índice, no el archivo.
 */
export function describeRejectedDocuments(
  verdicts: Record<string, TestSetZipVerdict>,
  documents_by_zip_key: Record<string, TestSetDocumentRef> = {},
  limit = 10,
): string[] {
  const lines: string[] = [];
  for (const verdict of Object.values(verdicts ?? {})) {
    if (!verdict || verdict.success) continue;
    const doc = documents_by_zip_key[verdict.zip_key];
    const who = doc?.number
      ? `${doc.number} (${doc.kind})`
      : `ZipKey ${verdict.zip_key}`;
    const rules = rejectionMessages(verdict);
    lines.push(
      `${who} → ${verdict.status_code}: ${
        rules.length ? rules.join(' | ') : verdict.status_message
      }`,
    );
    if (lines.length >= limit) break;
  }
  return lines;
}
