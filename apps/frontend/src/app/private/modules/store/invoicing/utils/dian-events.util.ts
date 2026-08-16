/**
 * VOCABULARIO DE EVENTOS RADIAN (Res. 000085/2022, Anexo Técnico numerales
 * 14.1.2 y 14.2.1).
 *
 * Un único dueño para los tres consumidores del módulo: el effect que reporta el
 * veredicto, el modal que ofrece los códigos y la lista de auditoría del detalle.
 * Antes las etiquetas vivían dentro de `components/invoice-detail/`, y desde ahí
 * un effect no puede importarlas sin invertir las capas; peor aún, el modal
 * habría acabado con su propia copia y la deriva entre las dos sería invisible
 * hasta que un código apareciera con dos nombres distintos en la misma pantalla.
 *
 * Todo lo de acá está COPIADO VERBATIM de
 * `apps/backend/src/domains/store/invoicing/providers/dian-direct/constants/dian-endpoints.ts`.
 * Se duplica porque el frontend no alcanza al backend; el riesgo de deriva se
 * acota con el mismo criterio que el resto del módulo: un código sin etiqueta se
 * pinta con su número crudo (`Evento 052`) en vez de desaparecer de la pantalla.
 */

/** `dian_document_events.event_code` → nombre del acto (numeral 14.2.1). */
const DIAN_EVENT_LABELS: Record<string, string> = {
  '030': 'Acuse de recibo de la factura',
  '031': 'Reclamo de la factura',
  '032': 'Recibo del bien o servicio',
  '033': 'Aceptación expresa',
  '034': 'Aceptación tácita',
  '035': 'Aval',
  '036': 'Inscripción en el RADIAN como título valor',
  '037': 'Endoso en propiedad',
  '038': 'Endoso en garantía',
  '039': 'Endoso en procuración',
  '040': 'Cancelación de endoso',
  '041': 'Limitación para circulación',
  '042': 'Terminación de la limitación para circulación',
  '043': 'Mandato',
  '044': 'Terminación del mandato',
  '045': 'Pago de la factura como título valor',
  '046': 'Informe para el pago',
  '047': 'Endoso con efectos de cesión ordinaria',
  '048': 'Protesto',
  '049': 'Transferencia de los derechos económicos',
  '050': 'Notificación al deudor sobre la transferencia de derechos económicos',
  '051': 'Pago de la transferencia de los derechos económicos',
};

export function dianEventLabel(code: string): string {
  return DIAN_EVENT_LABELS[code] ?? `Evento ${code}`;
}

/**
 * Tipos de operación por evento (numeral 14.1.2), lo que el backend exige en
 * `operation_code` y termina en `cbc:CustomizationID`.
 *
 * Cuando la lista tiene UN solo elemento el backend lo infiere y el modal no
 * pregunta nada. Cuando tiene varios la elección es jurídica —endoso con o sin
 * responsabilidad, pago parcial o total— y `assertOperationCode` la EXIGE:
 * adivinarla registraría un acto distinto del que el comerciante quiso.
 */
const DIAN_EVENT_OPERATION_CODES: Record<string, readonly string[]> = {
  '030': ['030'],
  '031': ['031'],
  '032': ['032'],
  '033': ['033'],
  '034': ['034'],
  '035': ['035'],
  '036': ['361', '362', '363', '364'],
  '037': ['371', '372'],
  '038': ['038'],
  '039': ['039'],
  '040': ['401', '402', '403'],
  '041': ['411', '412'],
  '042': ['421', '422'],
  '043': ['431', '432', '433', '434'],
  '044': ['441', '442', '443'],
  '045': ['451', '452'],
  '046': ['046'],
  '047': ['047'],
  '048': ['481', '482'],
  '049': ['491', '492', '493', '494'],
  '050': ['050'],
  '051': ['511', '512'],
};

const DIAN_EVENT_OPERATION_LABELS: Record<string, string> = {
  '361':
    'Primera inscripción como título valor para Negociación General',
  '362':
    'Primera inscripción como título valor para Negociación Directa Previa',
  '363':
    'Inscripción posterior como título valor para Negociación General',
  '364':
    'Inscripción posterior como título valor para Negociación Directa Previa',
  '371': 'Endoso con responsabilidad del endosante',
  '372': 'Endoso sin responsabilidad del endosante',
  '401': 'Cancelación del endoso en garantía',
  '402': 'Cancelación del endoso en procuración',
  '403': 'Tacha de endosos por endoso en retorno',
  '411': 'Auto que decreta medida cautelar por embargo',
  '412': 'Auto que decreta medida cautelar por mandamiento de pago',
  '421': 'Terminación de limitación por sentencia',
  '422': 'Terminación de limitación por terminación anticipada',
  '431': 'Mandato por documento general por tiempo limitado',
  '432': 'Mandato por documento general por tiempo ilimitado',
  '433': 'Mandato por documento limitado por tiempo limitado',
  '434': 'Mandato por documento limitado por tiempo ilimitado',
  '441': 'Terminación del mandato por revocación del mandante',
  '442': 'Terminación del mandato por renuncia del mandatario',
  '443': 'Terminación del mandato por rechazo del mandante',
  '451': 'Pago parcial de la factura como título valor',
  '452': 'Pago total de la factura como título valor',
  '481': 'Protesto por falta de aceptación',
  '482': 'Protesto por falta de pago',
  '491': 'Transferencia parcial de los derechos económicos con responsabilidad',
  '492': 'Transferencia total de los derechos económicos con responsabilidad',
  '493': 'Transferencia parcial de los derechos económicos sin responsabilidad',
  '494': 'Transferencia total de los derechos económicos sin responsabilidad',
  '511': 'Pago parcial de la transferencia de los derechos económicos',
  '512': 'Pago total de la transferencia de los derechos económicos',
};

export function dianEventOperationLabel(code: string): string {
  return DIAN_EVENT_OPERATION_LABELS[code] ?? code;
}

/**
 * EVENTOS QUE ESTE PANEL NO PUEDE REGISTRAR, Y POR QUÉ.
 *
 * `buildEventDetails` del backend rechaza estos códigos sin el anexo
 * `InformacionNegociacion` completo (`DIAN_EVENT_REQUIRED_NEGOTIATION_FIELDS`) y,
 * para los endosos, sin decir si es completo o en blanco más los datos del
 * endosatario (art. 654 C.Co.). Capturar eso bien es un formulario de negociación
 * entero, no un campo más.
 *
 * SE MUESTRAN DESHABILITADOS CON SU MOTIVO, NO SE ESCONDEN. Un comerciante que
 * busca «Endoso en propiedad» y no lo encuentra concluye que Vendix no lo tiene;
 * leyendo «exige los datos de la negociación» sabe que existe y qué falta. Y el
 * costo de esconderlos es peor que estético: intentarlo igual gastaría el
 * consecutivo del evento contra un rechazo de RADIAN.
 */
const DIAN_EVENT_UNSUPPORTED_IN_PANEL: Record<string, string> = {
  '035': 'Exige el valor avalado de la factura (anexo de negociación).',
  '037':
    'Exige los datos del endoso (valor, precio, tasa de descuento, medio de pago) y del endosatario.',
  '038': 'Exige el valor total del endoso y los datos del endosatario.',
  '039': 'Exige el valor total del endoso y los datos del endosatario.',
  '047':
    'Exige los datos de la cesión (valor, precio, tasa de descuento, medio de pago) y del cesionario.',
  '048': 'Exige el valor aceptado de la factura (anexo de negociación).',
  '051':
    'Exige el valor actual del título valor (anexo de negociación).',
};

export interface DianEventOption {
  /** Código del evento tal como viaja al backend. */
  value: string;
  /** `030 · Acuse de recibo de la factura`. */
  label: string;
  /** Motivo por el que el panel no puede registrarlo; `null` si sí puede. */
  unsupportedReason: string | null;
}

/**
 * Catálogo completo, en orden de código, con el motivo de bloqueo cuando aplica.
 * El consumidor decide si lo pinta deshabilitado o lo filtra; acá no se decide
 * por él, pero el motivo viaja siempre para que pueda decirlo.
 */
export function dianEventRegistrationOptions(): DianEventOption[] {
  return Object.keys(DIAN_EVENT_LABELS)
    .sort()
    .map((code) => ({
      value: code,
      label: `${code} · ${dianEventLabel(code)}`,
      unsupportedReason: DIAN_EVENT_UNSUPPORTED_IN_PANEL[code] ?? null,
    }));
}

export interface DianEventOperationOption {
  value: string;
  label: string;
}

/**
 * Tipos de operación a ofrecer para un evento.
 *
 * Devuelve `[]` cuando el evento tiene UNA sola operación: en ese caso el backend
 * la infiere y preguntar por ella sería un selector de una opción, ruido puro.
 * Un `[]` significa «no preguntes», NUNCA «no hay».
 */
export function dianEventOperationOptions(
  eventCode: string,
): DianEventOperationOption[] {
  const allowed = DIAN_EVENT_OPERATION_CODES[eventCode] ?? [];
  if (allowed.length <= 1) {
    return [];
  }
  return allowed.map((code) => ({
    value: code,
    label: `${code} · ${dianEventOperationLabel(code)}`,
  }));
}

/** `true` si el panel puede registrar este evento sin anexo de negociación. */
export function isDianEventRegistrable(eventCode: string): boolean {
  return (
    eventCode in DIAN_EVENT_LABELS &&
    !(eventCode in DIAN_EVENT_UNSUPPORTED_IN_PANEL)
  );
}

/** Motivo por el que el panel no registra este evento, o `null`. */
export function dianEventUnsupportedReason(eventCode: string): string | null {
  return DIAN_EVENT_UNSUPPORTED_IN_PANEL[eventCode] ?? null;
}
