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
}

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
