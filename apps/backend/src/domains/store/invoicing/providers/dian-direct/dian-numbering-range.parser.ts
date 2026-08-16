/**
 * Lectura de la respuesta de `GetNumberingRange` — los rangos de numeración que
 * la DIAN tiene AUTORIZADOS para un OFE, con la clave técnica (ClTec) que ella
 * misma ligó a cada resolución.
 *
 * ── POR QUÉ ESTE PARSER EXISTE ─────────────────────────────────────────────
 *
 * La ClTec es el 14.º campo del CUFE y la única entrada del hash que el XML NO
 * transporta: la DIAN recomputa el CUFE con la clave que ella emitió al
 * autorizar el rango. Hasta ahora esa clave se TECLEABA desde el portal MUISCA,
 * y el portal muestra en «Clave actual vigente» la clave que usaría una
 * resolución NUEVA — no necesariamente la ligada a la resolución que ya está
 * autorizada. Un tenant con «No. claves generadas: 3» copia la tercera y firma
 * con ella todo lo que emite bajo la primera: la DIAN rechaza cada documento con
 * `FAD06 — Valor del CUFE no está calculado correctamente` y el consecutivo
 * autorizado que gastó no se recupera.
 *
 * `GetNumberingRange` es la fuente autoritativa POR RESOLUCIÓN. Este archivo la
 * traduce; nadie más debe volver a transcribirla a mano.
 *
 * ── POR QUÉ REGEX Y NO UN PARSER XML ───────────────────────────────────────
 *
 * Es el patrón del repositorio: `DianSoapClient.parseSoapResponse` lee toda
 * respuesta SOAP con expresiones regulares, y `@xmldom/xmldom` sólo entra en el
 * camino de FIRMA (canonicalización C14N), donde sí hace falta un DOM. No hay
 * `fast-xml-parser` en el backend. Añadir una segunda tecnología de lectura por
 * una respuesta de ocho campos crearía dos formas de leer a la DIAN.
 *
 * ── POR QUÉ TODO ES AGNÓSTICO DE NAMESPACE ─────────────────────────────────
 *
 * La DIAN contesta con prefijos VARIABLES según la operación y el binding: la
 * misma respuesta llega con `a:`, `b:` o `i:` según el servicio y la versión del
 * WSDL. Anclar a un prefijo concreto es exactamente el defecto que dejó a
 * `parseSoapResponse` sin ver `<b:NumberRangeResponse>` y devolviendo
 * `NO_VERDICT` sobre una consulta perfectamente exitosa.
 */

/** Un rango tal como lo REPORTA la DIAN, sin cruzar todavía con lo local. */
export interface DianNumberingRange {
  resolution_number: string | null;
  prefix: string | null;
  range_from: number | null;
  range_to: number | null;
  /** ISO. `ValidDateFrom` en la nomenclatura de la DIAN. */
  valid_from: string | null;
  /** ISO. `ValidDateTo`. */
  valid_to: string | null;
  resolution_date: string | null;
  /**
   * ClTec EN CLARO. Nunca puede salir al navegador: quien la tiene recomputa el
   * CUFE de todo lo emitido bajo ese rango. La comparación contra la almacenada
   * se hace EN EL SERVIDOR y sólo viaja el booleano.
   */
  technical_key: string | null;
}

export interface ParsedNumberingRangeResponse {
  ranges: DianNumberingRange[];
  /**
   * Nombres de elemento DISTINTOS hallados en el cuerpo, sin prefijo de
   * namespace. Se llena SÓLO cuando no se extrajo ningún rango.
   *
   * Sin esto, el día que la DIAN renombre un campo la respuesta se lee como «no
   * tienes rangos autorizados» —una afirmación de negocio falsa— y nadie puede
   * depurarlo sin volcar el XML crudo, que trae la ClTec en claro. Con la lista
   * de nombres, el diagnóstico es inmediato y no expone el secreto.
   */
  element_names: string[];
}

/**
 * Contenedores de UN rango dentro de la lista. `NumberRangeResponse` es el que
 * documenta el Anexo; los otros dos se aceptan porque el WSDL de habilitación y
 * el de producción no siempre han coincidido en el nombre del ítem.
 */
const RANGE_ITEM_ELEMENTS = [
  'NumberRangeResponse',
  'NumberRange',
  'RangeResponse',
];

/**
 * Alias por campo, en orden de preferencia.
 *
 * El primero de cada lista es el nombre que la DIAN usa hoy. Los siguientes son
 * variantes vistas en documentación y en respuestas de habilitación. Aceptar
 * alias cuesta una comparación de cadena; NO aceptarlos cuesta una consulta que
 * miente diciendo que no hay rangos.
 */
const FIELD_ALIASES: Record<
  Exclude<keyof DianNumberingRange, never>,
  readonly string[]
> = {
  resolution_number: ['ResolutionNumber', 'ResolutionNo', 'NumeroResolucion'],
  prefix: ['Prefix', 'Prefijo'],
  range_from: ['FromNumber', 'RangeFrom', 'From', 'NumeroInicial'],
  range_to: ['ToNumber', 'RangeTo', 'To', 'NumeroFinal'],
  valid_from: [
    'ValidDateFrom',
    'ValidityDateFrom',
    'ValidFrom',
    'FechaVigenciaDesde',
  ],
  valid_to: ['ValidDateTo', 'ValidityDateTo', 'ValidTo', 'FechaVigenciaHasta'],
  resolution_date: ['ResolutionDate', 'FechaResolucion'],
  technical_key: ['TechnicalKey', 'ClaveTecnica', 'ClTec'],
};

/**
 * Lee la respuesta cruda y devuelve los rangos que la DIAN reporta.
 *
 * No lanza NUNCA: una respuesta ilegible se comunica con `ranges: []` y la lista
 * de nombres de elemento. Lanzar aquí convertiría un cambio de nomenclatura de
 * la DIAN en un 500 sin pista, justo en la herramienta que existe para
 * diagnosticar.
 */
export function parseNumberingRangeResponse(
  xml: string,
): ParsedNumberingRangeResponse {
  const body = extractSoapBody(xml ?? '');
  if (!body.trim()) {
    return { ranges: [], element_names: [] };
  }

  const blocks = extractRangeBlocks(body);
  const ranges = blocks
    .map((block) => parseRangeBlock(block))
    .filter((range) => hasAnyField(range));

  if (ranges.length > 0) {
    return { ranges, element_names: [] };
  }

  return { ranges: [], element_names: distinctElementNames(body) };
}

/**
 * Acota la lectura al `<Body>` del sobre. Fuera de él viven las cabeceras
 * WS-Addressing y WS-Security, cuyos nombres de elemento contaminarían
 * `element_names` con decenas de entradas que no dicen nada del negocio.
 *
 * Si no hay sobre —un fragmento guardado, una respuesta ya desenvuelta— se lee
 * el documento entero en vez de devolver vacío.
 */
function extractSoapBody(xml: string): string {
  const body = xml.match(/<(?:\w+:)?Body(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?Body>/i);
  return body?.[1] ?? xml;
}

/**
 * Trocea el cuerpo en un bloque por rango.
 *
 * FALLBACK DE RANGO ÚNICO: si no aparece ningún contenedor conocido pero el
 * cuerpo trae a lo sumo UNA clave técnica, se trata el cuerpo entero como un
 * solo rango. Es seguro precisamente por esa condición —con dos claves no se
 * puede saber qué prefijo va con cuál, y mezclarlos produciría un rango
 * inventado, que es peor que no leer nada—. Cubre el caso de un tenant con una
 * sola resolución autorizada cuyo WSDL omitió el envoltorio del ítem.
 */
function extractRangeBlocks(body: string): string[] {
  for (const element of RANGE_ITEM_ELEMENTS) {
    const matches = Array.from(
      body.matchAll(
        new RegExp(
          `<(?:\\w+:)?${element}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:\\w+:)?${element}>`,
          'gi',
        ),
      ),
    ).map((match) => match[1]);
    if (matches.length > 0) return matches;
  }

  const technical_keys = countElementOccurrences(
    body,
    FIELD_ALIASES.technical_key,
  );
  return technical_keys <= 1 ? [body] : [];
}

function parseRangeBlock(block: string): DianNumberingRange {
  return {
    resolution_number: pickText(block, FIELD_ALIASES.resolution_number),
    prefix: pickText(block, FIELD_ALIASES.prefix),
    range_from: pickInt(block, FIELD_ALIASES.range_from),
    range_to: pickInt(block, FIELD_ALIASES.range_to),
    valid_from: pickDate(block, FIELD_ALIASES.valid_from),
    valid_to: pickDate(block, FIELD_ALIASES.valid_to),
    resolution_date: pickDate(block, FIELD_ALIASES.resolution_date),
    technical_key: pickText(block, FIELD_ALIASES.technical_key),
  };
}

/** Un bloque sin un solo campo no es un rango: es ruido del sobre. */
function hasAnyField(range: DianNumberingRange): boolean {
  return Object.values(range).some((value) => value !== null);
}

function pickText(block: string, aliases: readonly string[]): string | null {
  for (const alias of aliases) {
    const match = block.match(
      new RegExp(
        `<(?:\\w+:)?${alias}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:\\w+:)?${alias}>`,
        'i',
      ),
    );
    const value = decodeXmlText(match?.[1] ?? '').trim();
    if (value) return value;
  }
  return null;
}

function pickInt(block: string, aliases: readonly string[]): number | null {
  const raw = pickText(block, aliases);
  if (raw === null) return null;
  const parsed = Number.parseInt(raw.replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Normaliza a ISO SIN pasar por el parseo local de `Date`.
 *
 * La DIAN manda `2026-07-29` o `2026-07-29T00:00:00` sin zona. `new Date()`
 * interpreta la segunda forma en la zona del SERVIDOR, así que en Bogotá
 * (UTC-5) la fecha retrocede un día al serializarla a ISO — y una vigencia
 * desplazada un día es exactamente lo que la DIAN rechaza con FAB07b/FAB08b.
 * Los tres primeros grupos se toman literales y se anclan en UTC.
 */
function pickDate(block: string, aliases: readonly string[]): string | null {
  const raw = pickText(block, aliases);
  if (raw === null) return null;

  const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!ymd) return raw;

  const iso = new Date(
    Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3])),
  );
  return Number.isNaN(iso.getTime()) ? raw : iso.toISOString();
}

function countElementOccurrences(
  body: string,
  aliases: readonly string[],
): number {
  return aliases.reduce((total, alias) => {
    const matches = body.match(
      new RegExp(`<(?:\\w+:)?${alias}(?:\\s[^>]*)?>`, 'gi'),
    );
    return total + (matches?.length ?? 0);
  }, 0);
}

/** Nombres de elemento sin prefijo, deduplicados y en orden de aparición. */
function distinctElementNames(body: string): string[] {
  const names = new Set<string>();
  for (const match of body.matchAll(
    /<(?:\w+:)?([A-Za-z_][\w.-]*)(?:\s[^>]*)?\/?>/g,
  )) {
    names.add(match[1]);
  }
  return Array.from(names);
}

/**
 * Entidades XML mínimas. Los valores de esta respuesta son alfanuméricos, pero
 * una razón social o un prefijo con `&` llegarían escapados y se guardarían
 * literalmente como `&amp;` si nadie los decodifica.
 */
function decodeXmlText(raw: string): string {
  return raw
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
