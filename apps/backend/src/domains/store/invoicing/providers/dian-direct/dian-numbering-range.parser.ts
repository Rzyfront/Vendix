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

/**
 * Las TRES cosas distintas que puede significar una lectura de esta respuesta.
 *
 * Antes sólo había dos —«leí rangos» o «no pude interpretar»— y eso obligaba a
 * publicar como fallo de contrato el caso más normal de todos: la DIAN contesta
 * con su estructura VIGENTE y su lista viene sin ítems porque ese NIT no tiene
 * numeración autorizada en ese ambiente. El panel lo traducía a «la DIAN
 * respondió con una estructura que no se pudo interpretar», acusaba a la DIAN de
 * un cambio de contrato inexistente y mandaba a depurar durante horas algo que
 * nunca estuvo roto. Separar los tres estados es la razón de ser de este tipo.
 */
export type NumberingRangeOutcome =
  | 'ranges'
  | 'empty_list'
  | 'unrecognized_contract';

export interface ParsedNumberingRangeResponse {
  ranges: DianNumberingRange[];
  /**
   * Qué ocurrió realmente. `empty_list` es una afirmación sobre el NEGOCIO del
   * comerciante («la DIAN no te reporta numeración aquí»); `unrecognized_contract`
   * lo es sobre el SOFTWARE («no entendimos lo que la DIAN dijo»). Confundirlas
   * manda al usuario a resolver el problema equivocado, que es exactamente lo
   * que pasó con la configuración 20 en habilitación.
   */
  outcome: NumberingRangeOutcome;
  /**
   * `OperationCode`: el veredicto que la DIAN da sobre la consulta misma.
   *
   * Es TEXTO DE ESTADO. No transporta ClTec ni nada con lo que se pueda
   * recomputar un CUFE, así que —al revés que `technical_key`— sí puede viajar
   * al navegador. Y es lo único que explica un `empty_list`, donde por diseño no
   * hay `element_names` que mirar.
   */
  operation_code: string | null;
  /** `OperationDescription`. Texto de estado, con el mismo criterio que `operation_code`. */
  operation_description: string | null;
  /**
   * Nombres de elemento DISTINTOS hallados en el cuerpo, sin prefijo de
   * namespace. Se llena SÓLO en `unrecognized_contract`.
   *
   * Sin esto, el día que la DIAN renombre un campo la respuesta se lee como «no
   * tienes rangos autorizados» —una afirmación de negocio falsa— y nadie puede
   * depurarlo sin volcar el XML crudo, que trae la ClTec en claro. Con la lista
   * de nombres, el diagnóstico es inmediato y no expone el secreto.
   *
   * En `empty_list` va VACÍA a propósito: ahí el contrato SÍ se entendió, no hay
   * anomalía que catalogar, y publicar la lista invitaría a leer como sospechosos
   * los nombres del contrato normal —el bucle de depuración que se está cerrando.
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
 * Campos de ESTADO de la respuesta, los que viven FUERA de la lista de rangos.
 * Mismo criterio de alias que `FIELD_ALIASES`: primero el nombre vigente,
 * después la variante en castellano vista en documentación.
 *
 * No describen un rango: son el veredicto de la DIAN sobre la consulta, y son lo
 * único que un operador tiene en la mano para entender por qué su lista vino
 * vacía sin que nadie le vuelque el XML crudo.
 */
const STATUS_FIELD_ALIASES = {
  operation_code: ['OperationCode', 'CodigoOperacion'],
  operation_description: ['OperationDescription', 'DescripcionOperacion'],
} as const;

/**
 * Envoltorios del contrato vigente de `GetNumberingRange`. Su presencia es la
 * prueba de que la DIAN habló SU idioma: si están, la respuesta se entendió, y
 * una lista sin ítems significa que no hay numeración autorizada —no que el
 * parser se haya quedado corto.
 */
const CONTRACT_WRAPPER_ELEMENTS = ['GetNumberingRangeResult', 'ResponseList'];

/**
 * Vocabulario COMPLETO de una respuesta vigente con la lista vacía: exactamente
 * los cinco nombres que devolvió la configuración 20 (NIT 1123408049, ambiente
 * de habilitación) el día que se capturó el caso.
 *
 * Existe para no cometer el error simétrico al que se está corrigiendo. Si
 * dentro del envoltorio aparece CUALQUIER otro nombre, la DIAN sí puso algo ahí
 * que no supimos leer —un campo renombrado, un ítem con otro nombre—, y llamar
 * a eso «lista vacía» afirmaría en falso, ahora contra el comerciante, que no
 * tiene rangos autorizados. Los contenedores de ítem (`RANGE_ITEM_ELEMENTS`) se
 * dejan FUERA a propósito: un `<NumberRangeResponse>` del que no se extrajo ni
 * un campo es un rango que existe y no supimos leer, no una lista vacía.
 */
const EMPTY_CONTRACT_ELEMENTS = new Set(
  [
    'GetNumberingRangeResponse',
    ...CONTRACT_WRAPPER_ELEMENTS,
    ...STATUS_FIELD_ALIASES.operation_code,
    ...STATUS_FIELD_ALIASES.operation_description,
  ].map((name) => name.toLowerCase()),
);

/**
 * Lee la respuesta cruda y devuelve los rangos que la DIAN reporta, junto con el
 * veredicto de por qué son los que son.
 *
 * No lanza NUNCA: una respuesta ilegible se comunica con `ranges: []`,
 * `outcome: 'unrecognized_contract'` y la lista de nombres de elemento. Lanzar
 * aquí convertiría un cambio de nomenclatura de la DIAN en un 500 sin pista,
 * justo en la herramienta que existe para diagnosticar.
 */
export function parseNumberingRangeResponse(
  xml: string,
): ParsedNumberingRangeResponse {
  const body = extractSoapBody(xml ?? '');
  if (!body.trim()) {
    /**
     * Un cuerpo vacío NO es `empty_list`. No hubo respuesta que interpretar
     * —red caída, sobre truncado, cadena vacía— y decirle al comerciante «la
     * DIAN no te reporta numeración» sería la misma clase de mentira que este
     * parser existe para no repetir, sólo que en la dirección contraria.
     */
    return {
      ranges: [],
      outcome: 'unrecognized_contract',
      operation_code: null,
      operation_description: null,
      element_names: [],
    };
  }

  // El veredicto de la DIAN vive FUERA de la lista, así que se lee del cuerpo
  // entero y acompaña por igual a las tres salidas: con rangos también informa.
  const operation_code = pickText(body, STATUS_FIELD_ALIASES.operation_code);
  const operation_description = pickText(
    body,
    STATUS_FIELD_ALIASES.operation_description,
  );

  const blocks = extractRangeBlocks(body);
  const ranges = blocks
    .map((block) => parseRangeBlock(block))
    .filter((range) => hasAnyField(range));

  if (ranges.length > 0) {
    return {
      ranges,
      outcome: 'ranges',
      operation_code,
      operation_description,
      element_names: [],
    };
  }

  /**
   * La clasificación va DESPUÉS del filtrado por `hasAnyField`, y el orden no es
   * cosmético: el fallback de rango único mete el cuerpo ENTERO en
   * `parseRangeBlock` aunque `ResponseList` venga vacío, y sólo tras descartar
   * ese bloque sin un solo campo se sabe que de verdad no había rangos que leer.
   * Clasificar antes daría `ranges: [ {todo null} ]` y ninguna de las tres
   * respuestas sería cierta.
   */
  const outcome = classifyEmptyResult(body);
  return {
    ranges: [],
    outcome,
    operation_code,
    operation_description,
    element_names:
      outcome === 'unrecognized_contract' ? distinctElementNames(body) : [],
  };
}

/**
 * Decide si una lectura sin rangos es «la DIAN no reporta numeración» o «no
 * entendimos a la DIAN». El panel convierte esta distinción en una frase
 * dirigida al comerciante, así que se resuelve con dos condiciones verificables
 * y ninguna heurística.
 */
function classifyEmptyResult(body: string): NumberingRangeOutcome {
  const has_wrapper = CONTRACT_WRAPPER_ELEMENTS.some((element) =>
    containsElement(body, element),
  );
  if (!has_wrapper) return 'unrecognized_contract';

  const unknown = distinctElementNames(body).filter(
    (name) => !EMPTY_CONTRACT_ELEMENTS.has(name.toLowerCase()),
  );
  return unknown.length === 0 ? 'empty_list' : 'unrecognized_contract';
}

/**
 * Presencia de un elemento, con o sin prefijo de namespace y esté o no
 * autocerrado. El `\/?` importa: la lista vacía llega precisamente como
 * `<a:ResponseList/>`, y una regex que exija `>` inmediato no la ve.
 */
function containsElement(body: string, name: string): boolean {
  return new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?\\/?>`, 'i').test(body);
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
