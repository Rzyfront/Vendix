/**
 * File naming for the documents delivered to DIAN inside a ZIP batch.
 *
 * ✅ VERIFICADO CONTRA LA FUENTE PRIMARIA — Resolución 000165 (01/NOV/2023),
 * Anexo Técnico de la Factura Electrónica de Venta v1.9, numerales 6.5.7 y
 * 6.5.8 (páginas 303-304):
 *
 *   XML: <tag><nnnnnnnnnn><ppp><aa><dddddddd>.xml   (2+10+3+2+8 = 25 chars)
 *   ZIP:    z <nnnnnnnnnn><ppp><aa><dddddddd>.zip   (1+10+3+2+8 = 24 chars)
 *
 *   nnnnnnnnnn  NIT del facturador SIN DV, 10 dígitos, relleno con ceros a la izquierda
 *   ppp         código asignado por la DIAN al software, 3 dígitos
 *                 000 = Software Propio · 001 = Facturación Gratuita DIAN
 *                 otro = código de 3 dígitos del Proveedor Tecnológico
 *   aa          dos últimos dígitos del año calendario en vigencia
 *   dddddddd    consecutivo de archivos enviados, 8 dígitos HEXADECIMALES,
 *                 rango 00000001 <= FFFFFFFF
 *
 * Ejemplos textuales del anexo, que `dian-file-naming.util.spec.ts` verifica:
 *   Fv08001972680001900000011.xml   nc08001972680001900000001.xml
 *   nd08001972680001900000003.xml   ar08001972680001900000008.xml
 *   ad08001972680001900000001.xml   Z08001972680001900000011.zip
 *
 * El anexo es explícito sobre por qué el largo importa:
 *   «Los tamaños de cada variable son constantes, es necesario generar el
 *    ajuste con ceros a la izquierda en cada uno de ellos.»
 *
 * POR QUÉ EXISTE ESTE MÓDULO — el defecto que cierra:
 *
 * La versión anterior omitía `ppp` y `aa` por completo y producía nombres de 20
 * caracteres (`fv09020565893b023384.xml`). `SendTestSetAsync` valida en línea
 * solo que el ZIP no esté vacío ni corrupto y que los UBL traigan CUFE, número,
 * fecha, NIT y versión — el nombre del archivo NO se valida ahí, así que la DIAN
 * devuelve un ZipKey y el envío parece exitoso. El worker asíncrono sí parsea el
 * nombre por posiciones fijas: con 5 caracteres de menos los campos quedan
 * corridos y el archivo nunca se asocia al set de pruebas. El síntoma es un
 * trío que ninguna otra causa produce:
 *
 *   · `GetStatusZip` → «Batch en proceso de validación» indefinidamente
 *   · portal de habilitación → Recibidos 0, Aceptados 0, **Rechazados 0**
 *   · `GetStatus` por CUFE → código 66 «TrackId no existe»
 *
 * Cero rechazos es la firma: los documentos nunca llegaron a la validación por
 * documento, así que no había nada que rechazar.
 *
 * DESVIACIÓN CONOCIDA Y ACEPTADA: el anexo define `dddddddd` como «consecutivo
 * de archivos enviados» que se reinicia en 00000001 cada 1 de enero. Aquí se
 * deriva del número del documento, que es monótono creciente, único y cae dentro
 * del rango exigido. La DIAN no puede validar el valor semántico de un contador
 * que solo existe de nuestro lado — solo formato, largo y rango, que sí se
 * cumplen. Un contador persistido real exigiría una columna nueva y no cierra
 * ningún defecto observable.
 */

/**
 * Prefijos verificados contra los tres anexos técnicos. El prefijo tiene 2 o 3
 * letras según el tipo; el cuerpo es idéntico en los tres documentos.
 *
 *  Anexo FE de Venta v1.9, numeral 6.5.7:
 *    fv  Factura de Venta            nc  Nota Crédito
 *    nd  Nota Débito                 ar  Application Response
 *    ad  Attached Document
 *
 *  Anexo Documento Soporte en adquisiciones a no obligados a facturar:
 *    ds  Documento Soporte
 *    nas Nota de ajuste al documento soporte
 *    ars Application Response Soporte
 *
 *  Anexo Documentos Equivalentes Electrónicos v1.0:
 *    ds  Documento equivalente electrónico   ← el MISMO `ds` del documento
 *        soporte. No es un error de transcripción: los dos anexos de la DIAN
 *        asignan `ds` a documentos distintos, así que el nombre del archivo no
 *        discrimina entre ellos — lo hace el contenido UBL.
 *    ncs Nota de ajuste al documento equivalente electrónico
 *    ars Application Response Soporte
 */
export const DIAN_FILE_TAGS = {
  invoice: 'fv',
  credit_note: 'nc',
  debit_note: 'nd',
  application_response: 'ar',
  attached_document: 'ad',
  support_document: 'ds',
  support_adjustment_note: 'nas',
  equivalent_document: 'ds',
  equivalent_adjustment_note: 'ncs',
  application_response_support: 'ars',
} as const;

export type DianDocumentKind = keyof typeof DIAN_FILE_TAGS;

/** Códigos `ppp` que el anexo fija de forma literal (numeral 6.5.7, Notas). */
export const DIAN_SOFTWARE_CODES = {
  own_software: '000',
  dian_free_billing: '001',
} as const;

/** Largo exacto de cada campo. Un campo corrido es el defecto que este módulo cierra. */
const NIT_LENGTH = 10;
const SOFTWARE_CODE_LENGTH = 3;
const YEAR_LENGTH = 2;
const CONSECUTIVE_LENGTH = 8;
const BODY_LENGTH =
  NIT_LENGTH + SOFTWARE_CODE_LENGTH + YEAR_LENGTH + CONSECUTIVE_LENGTH;

export interface DianFileNameParts {
  /** NIT del facturador electrónico. El DV se descarta si viene pegado. */
  nit: string;
  /** Número del documento SIN el prefijo de la resolución. */
  consecutive: number | string;
  /**
   * `ppp`. Por defecto `000` (software propio), que es el único modo con el que
   * este backend emite hoy. Un Proveedor Tecnológico debe pasar el código de 3
   * dígitos que la DIAN le asignó.
   */
  software_code?: string | null;
  /**
   * `aa`. Año calendario en vigencia. Acepta un año numérico, una fecha
   * `YYYY-MM-DD` o un `Date`. Por defecto el año actual.
   *
   * Se pasa la fecha de emisión del documento en vez de leer el reloj para que
   * un lote emitido el 31 de diciembre no cambie de nombre al cruzar la
   * medianoche a mitad de armado.
   */
  year?: number | string | Date;
}

/** NIT sin DV, 10 dígitos, alineado a la derecha con ceros. */
function normalizeNit(nit: string): string {
  return nit.replace(/\D/g, '').slice(0, NIT_LENGTH).padStart(NIT_LENGTH, '0');
}

/** `ppp` — 3 dígitos. Sin valor válido cae a software propio. */
function normalizeSoftwareCode(code?: string | null): string {
  const digits = (code ?? '').replace(/\D/g, '');
  if (!digits) return DIAN_SOFTWARE_CODES.own_software;
  return digits
    .slice(0, SOFTWARE_CODE_LENGTH)
    .padStart(SOFTWARE_CODE_LENGTH, '0');
}

/** `aa` — dos últimos dígitos del año. */
function normalizeYear(year?: number | string | Date): string {
  let resolved: number;
  if (typeof year === 'number' && Number.isFinite(year)) {
    resolved = year;
  } else if (typeof year === 'string') {
    // Cubre 'YYYY' y 'YYYY-MM-DD' sin construir un Date, que reinterpretaría
    // la fecha en UTC y podría restar un día — y con él, el año.
    const parsed = parseInt(year.slice(0, 4), 10);
    resolved = Number.isFinite(parsed) ? parsed : new Date().getFullYear();
  } else if (year instanceof Date && !Number.isNaN(year.getTime())) {
    resolved = year.getUTCFullYear();
  } else {
    resolved = new Date().getFullYear();
  }
  return String(Math.abs(resolved) % 100).padStart(YEAR_LENGTH, '0');
}

/** `dddddddd` — consecutivo en 8 dígitos hexadecimales, alineado con ceros. */
function normalizeConsecutive(consecutive: number | string): string {
  const numeric =
    typeof consecutive === 'number' ? consecutive : parseInt(consecutive, 10);
  const safe = Number.isFinite(numeric) && numeric > 0 ? numeric : 1;
  return safe
    .toString(16)
    .toLowerCase()
    .slice(-CONSECUTIVE_LENGTH)
    .padStart(CONSECUTIVE_LENGTH, '0');
}

/**
 * Cuerpo común del nombre: `nnnnnnnnnn` + `ppp` + `aa` + `dddddddd`.
 *
 * El chequeo de largo no es defensivo por gusto: el defecto original era
 * exactamente un cuerpo corto que la DIAN acepta sin quejarse y descarta en
 * silencio horas después. Preferimos reventar en el proceso que emite.
 */
function buildBody(parts: DianFileNameParts): string {
  const body =
    normalizeNit(parts.nit) +
    normalizeSoftwareCode(parts.software_code) +
    normalizeYear(parts.year) +
    normalizeConsecutive(parts.consecutive);

  if (body.length !== BODY_LENGTH) {
    throw new Error(
      `DIAN file name body must be exactly ${BODY_LENGTH} characters (NIT 10 + ppp 3 + aa 2 + consecutivo 8), got ${body.length}: "${body}"`,
    );
  }
  return body;
}

/**
 * Extrae el consecutivo numérico de un número de documento con prefijo.
 *
 * Toma la corrida final de dígitos, no «todos los dígitos»: `SETP990000004` da
 * 990000004 con ambas reglas, pero un prefijo con año dentro (`FE-2026-123`)
 * daría 2026123 al barrer todo y 123 tomando el final, que es el consecutivo
 * real. El campo `dddddddd` mide 8 dígitos hexadecimales, así que un número
 * inflado por el prefijo desbordaría y se truncaría en silencio.
 */
export function consecutiveFromDocumentNumber(document_number: string): number {
  const trailing = /(\d+)$/.exec(document_number ?? '');
  const parsed = trailing ? parseInt(trailing[1], 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/** Nombre del XML de un documento dentro del lote. */
export function buildDianXmlFileName(
  kind: DianDocumentKind,
  parts: DianFileNameParts,
): string {
  return `${DIAN_FILE_TAGS[kind]}${buildBody(parts)}.xml`;
}

/**
 * Nombre del ZIP contenedor. `consecutive` debe ser el primer documento del
 * lote, para que el contenedor sea rastreable hasta su contenido.
 */
export function buildDianZipFileName(parts: DianFileNameParts): string {
  return `z${buildBody(parts)}.zip`;
}

/**
 * Traduce `dian_configurations.operation_mode` al código `ppp`.
 *
 * Revienta en `technological_provider` a propósito. Ese modo exige el código de
 * 3 dígitos que la DIAN asigna al Proveedor Tecnológico, y ninguna columna lo
 * guarda todavía. Caer a `000` nombraría el archivo como software propio y
 * volvería a desasociar el lote — el defecto exacto que este módulo cierra —
 * pero esta vez sin síntoma nuevo que lo delate. Fallar al generar cuesta un
 * error legible; fallar en silencio cuesta 50 consecutivos autorizados.
 */
export function softwareCodeForOperationMode(
  operation_mode?: string | null,
): string {
  if (!operation_mode || operation_mode === 'own_software') {
    return DIAN_SOFTWARE_CODES.own_software;
  }
  if (operation_mode === 'dian_free_billing') {
    return DIAN_SOFTWARE_CODES.dian_free_billing;
  }
  throw new Error(
    `El modo de operación "${operation_mode}" necesita el código de 3 dígitos que la DIAN asigna al Proveedor Tecnológico para nombrar los archivos (campo "ppp" del Anexo Técnico 1.9, numeral 6.5.7). No hay dónde guardarlo todavía: no se puede emitir en este modo.`,
  );
}
