/**
 * Pure, dependency-free helpers for parsing and normalizing Colombian street
 * addresses (DANE nomenclature, intersections, rural/manzana forms), plus
 * candidate selection for Nominatim `/search` results. No network, no Redis,
 * no NestJS DI — unit-testable in isolation (see
 * `colombian-address.util.spec.ts`).
 */

/** Canonical via-type labels this module normalizes abbreviations into. */
export type ViaTipo =
  | 'Calle'
  | 'Carrera'
  | 'Avenida'
  | 'Avenida Calle'
  | 'Avenida Carrera'
  | 'Diagonal'
  | 'Transversal'
  | 'Circular'
  | 'Circunvalar'
  | 'Autopista'
  | 'Vía';

export type AddressKind =
  | 'dane'
  | 'interseccion'
  | 'manzana'
  | 'rural'
  | 'libre';

export interface ComplementosColombianos {
  torre?: string;
  apto?: string;
  interior?: string;
  casa?: string;
  oficina?: string;
  local?: string;
  bodega?: string;
  modulo?: string;
  piso?: string;
  manzana?: string;
  lote?: string;
  bloque?: string;
  etapa?: string;
}

export interface RuralColombianAddress {
  km?: string;
  via?: string;
  vereda?: string;
  corregimiento?: string;
  sector?: string;
  finca?: string;
}

export interface ParsedColombianAddress {
  /** Original input, unmodified. */
  raw: string;
  /** Canonical rebuilt line, safe to feed to Nominatim `street=`/`q=`. */
  normalized: string;
  /** High-level shape of the address. */
  kind: AddressKind;
  /** Recognized main via type, or null when the text has no via type. */
  viaTipo: ViaTipo | null;
  viaNum: string | null;
  viaLetra: string | null;
  viaBis: string | null;
  viaCuadrante: string | null;
  /** Cross/generating via — only set for "con"/"y" intersection text. */
  cruceTipo: ViaTipo | null;
  cruceNum: string | null;
  cruceLetra: string | null;
  cruceBis: string | null;
  cruceCuadrante: string | null;
  /** House plate (DANE: the value after the last dash). */
  placa: string | null;
  placaCuadrante: string | null;
  /** End of a plate range ("13-02 al 13-20" -> "20"). */
  placaRangoFin: string | null;
  complementos: ComplementosColombianos;
  barrio: string | null;
  urbanizacion: string | null;
  conjunto: string | null;
  rural: RuralColombianAddress | null;
  /** Text before a parenthesised legacy via ("Avenida del Ferrocarril (Carrera 15)..."). */
  legacyName: string | null;
  /** Stripped complements joined as a legacy display string. */
  complement: string | null;
  /** True only when viaTipo + viaNum + cruceNum + placa all resolved (kind === 'dane'). */
  isDaneFormat: boolean;
}

export interface ParsedFreeTextQuery {
  addressLine: string;
  city: string | null;
  state: string | null;
}

const CUADRANTE_WORDS = new Set(['sur', 'norte', 'este', 'oeste']);
const COUNTRY_SEGMENT_RE = /^\s*(colombia|co)\s*$/i;

/**
 * Via-type matchers, longest/most-specific literal first. Each pattern is
 * anchored at the start of the (trimmed) string and requires whitespace or
 * end-of-string right after, so it never matches mid-word.
 */
const VIA_TIPO_TABLE: Array<{ re: RegExp; tipo: ViaTipo }> = [
  { re: /^avenida\s+carrera(?=\s|$)/i, tipo: 'Avenida Carrera' },
  { re: /^avenida\s+calle(?=\s|$)/i, tipo: 'Avenida Calle' },
  { re: /^av\.?\s+carrera(?=\s|$)/i, tipo: 'Avenida Carrera' },
  { re: /^av\.?\s+calle(?=\s|$)/i, tipo: 'Avenida Calle' },
  { re: /^av\.?\s*cra\.?(?=\s|$)/i, tipo: 'Avenida Carrera' },
  { re: /^av\.?\s*cl\.?(?=\s|$)/i, tipo: 'Avenida Calle' },
  { re: /^ak(?=\s|$)/i, tipo: 'Avenida Carrera' },
  { re: /^ac(?=\s|$)/i, tipo: 'Avenida Calle' },
  { re: /^avenida(?=\s|$)/i, tipo: 'Avenida' },
  { re: /^avda\.?(?=\s|$)/i, tipo: 'Avenida' },
  { re: /^av\.?(?=\s|$)/i, tipo: 'Avenida' },
  { re: /^circunvalar(?=\s|$)/i, tipo: 'Circunvalar' },
  { re: /^cv(?=\s|$)/i, tipo: 'Circunvalar' },
  { re: /^circular(?=\s|$)/i, tipo: 'Circular' },
  { re: /^cq(?=\s|$)/i, tipo: 'Circular' },
  { re: /^cir\.?(?=\s|$)/i, tipo: 'Circular' },
  { re: /^autopista(?=\s|$)/i, tipo: 'Autopista' },
  { re: /^aut\.?(?=\s|$)/i, tipo: 'Autopista' },
  { re: /^diagonal(?=\s|$)/i, tipo: 'Diagonal' },
  { re: /^diag\.?(?=\s|$)/i, tipo: 'Diagonal' },
  { re: /^dg\.?(?=\s|$)/i, tipo: 'Diagonal' },
  { re: /^transversal(?=\s|$)/i, tipo: 'Transversal' },
  { re: /^transv\.?(?=\s|$)/i, tipo: 'Transversal' },
  { re: /^tv\.?(?=\s|$)/i, tipo: 'Transversal' },
  { re: /^tr\.?(?=\s|$)/i, tipo: 'Transversal' },
  { re: /^carrera(?=\s|$)/i, tipo: 'Carrera' },
  { re: /^kra\.?(?=\s|$)/i, tipo: 'Carrera' },
  { re: /^cra\.?(?=\s|$)/i, tipo: 'Carrera' },
  { re: /^kr\.?(?=\s|$)/i, tipo: 'Carrera' },
  { re: /^cr\.?(?=\s|$)/i, tipo: 'Carrera' },
  { re: /^calle(?=\s|$)/i, tipo: 'Calle' },
  { re: /^cll\.?(?=\s|$)/i, tipo: 'Calle' },
  { re: /^cl\.?(?=\s|$)/i, tipo: 'Calle' },
  { re: /^v[ií]a(?=\s|$)/i, tipo: 'Vía' },
];

/** DANE house-number separator: "#", "No.", "N°", "Nro.", "Número" — only when
 * immediately (ignoring spaces) followed by a digit. */
const SEPARATOR_RE =
  /\b(?:No|Nro|N[uú]mero)\.?\s*(?=\d)|N°\s*(?=\d)|#\s*(?=\d)/i;

/** Intersection connector: "con"/"y" as whole words. */
const CON_Y_RE = /\s+(?:con|y)\s+/i;

/** "13-02 al 13-20" plate range. */
const AL_RANGE_RE = /\s+al\s+/i;

const COMPLEMENT_KEY_MAP: Record<string, keyof ComplementosColombianos> = {
  apartamento: 'apto',
  apto: 'apto',
  apt: 'apto',
  torre: 'torre',
  tor: 'torre',
  interior: 'interior',
  int: 'interior',
  casa: 'casa',
  oficina: 'oficina',
  of: 'oficina',
  local: 'local',
  lc: 'local',
  bodega: 'bodega',
  bod: 'bodega',
  modulo: 'modulo',
  módulo: 'modulo',
  mod: 'modulo',
  piso: 'piso',
  manzana: 'manzana',
  mz: 'manzana',
  lote: 'lote',
  lt: 'lote',
  bloque: 'bloque',
  bl: 'bloque',
  etapa: 'etapa',
};

/**
 * Complement keywords, with a mandatory trailing `\b` so a keyword only
 * matches on a real word boundary — this is what keeps "Torres", "Edgar",
 * "Interamericana", "Blanco", "Casablanca" intact (previously `int`/`casa`/
 * `bl`/`tor` could match mid-word with no boundary after the keyword).
 */
const COMPLEMENT_RE =
  /\b(apartamento|apto|apt|torre|tor|interior|int|casa|oficina|of|local|lc|bodega|bod|m[oó]dulo|mod|piso|manzana|mz|lote|lt|bloque|bl|etapa)\b\.?\s*([a-zA-Z0-9]+)?/gi;

/** Accent-insensitive, lowercased normalization for comparisons. */
function normText(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function matchViaTipo(
  text: string,
): { tipo: ViaTipo; consumed: number } | null {
  for (const { re, tipo } of VIA_TIPO_TABLE) {
    const m = text.match(re);
    if (m) return { tipo, consumed: m[0].length };
  }
  return null;
}

/** "43A" -> "43 A", "21A1" -> "21 A1" (splits only the digit->letter transition). */
function splitAttachedLetter(text: string): string {
  return text.replace(/(\d)([A-Za-z])/g, '$1 $2');
}

interface ViaNumberParts {
  num: string | null;
  letra: string | null;
  bis: string | null;
  cuadrante: string | null;
}

/** Extracts number/letra/bis/cuadrante from a via-number token, order-independent. */
function parseViaNumberTokens(text: string | null | undefined): ViaNumberParts {
  const empty = { num: null, letra: null, bis: null, cuadrante: null };
  if (!text) return empty;
  const prepped = splitAttachedLetter(text.trim()).replace(/\s+/g, ' ').trim();
  if (!prepped) return empty;
  let num: string | null = null;
  let letra: string | null = null;
  let bis: string | null = null;
  let cuadrante: string | null = null;
  const unrecognized: string[] = [];
  for (const w of prepped.split(' ')) {
    const lw = w.toLowerCase().replace(/\.$/, '');
    if (/^\d+$/.test(w) && num === null) {
      num = w;
    } else if (lw === 'bis') {
      bis = 'Bis';
    } else if (CUADRANTE_WORDS.has(lw)) {
      cuadrante = lw.charAt(0).toUpperCase() + lw.slice(1);
    } else if (/^[a-zA-Z]\d*$/.test(w) && letra === null) {
      letra = w.toUpperCase();
    } else {
      unrecognized.push(w);
    }
  }
  // No digit found at all: this is a NAMED via number ("Interamericana",
  // "del Ferrocarril"...), not a DANE numeric one — keep the original text
  // instead of silently dropping it.
  if (num === null && unrecognized.length) {
    num = unrecognized.join(' ');
  }
  return { num, letra, bis, cuadrante };
}

/** Extracts a combined placa string (number + optional attached letter) + trailing cuadrante. */
function parsePlacaTokens(text: string | null | undefined): {
  placa: string | null;
  cuadrante: string | null;
} {
  if (!text) return { placa: null, cuadrante: null };
  const prepped = splitAttachedLetter(text.trim()).replace(/\s+/g, ' ').trim();
  if (!prepped) return { placa: null, cuadrante: null };
  const kept: string[] = [];
  let cuadrante: string | null = null;
  for (const w of prepped.split(' ')) {
    const lw = w.toLowerCase();
    if (CUADRANTE_WORDS.has(lw)) {
      cuadrante = lw.charAt(0).toUpperCase() + lw.slice(1);
    } else {
      kept.push(/^[a-zA-Z]$/.test(w) ? w.toUpperCase() : w);
    }
  }
  return { placa: kept.length ? kept.join('') : null, cuadrante };
}

/** Splits a DANE tail using the LAST dash; falls back to a bare space split
 * ("62 40") when no dash is present, so "Nro 62 40" still separates cross/plate. */
function splitCrossAndPlate(tail: string): {
  cruceNum: string | null;
  placa: string | null;
} {
  const trimmed = tail.trim();
  if (!trimmed) return { cruceNum: null, placa: null };
  const dash = trimmed.lastIndexOf('-');
  if (dash >= 0) {
    return {
      cruceNum: trimmed.slice(0, dash).trim() || null,
      placa: trimmed.slice(dash + 1).trim() || null,
    };
  }
  const spaceMatch = trimmed.match(/^(\S+)\s+(\S+)$/);
  if (spaceMatch) return { cruceNum: spaceMatch[1], placa: spaceMatch[2] };
  return { cruceNum: null, placa: trimmed || null };
}

function buildNumToken(
  num: string | null,
  letra?: string | null,
  bis?: string | null,
  cuadrante?: string | null,
): string {
  return [num, letra, bis, cuadrante].filter(Boolean).join(' ');
}

/**
 * Strips complement keywords (apto/torre/interior/casa/piso/bloque/local/...)
 * out of a line, returning the cleaned text plus the raw matched fragments
 * and a structured map. Word-boundary-safe (see {@link COMPLEMENT_RE}).
 */
function extractComplement(text: string): {
  cleaned: string;
  fragments: string[];
  map: ComplementosColombianos;
} {
  const fragments: string[] = [];
  const map: ComplementosColombianos = {};
  const cleaned = text
    .replace(
      COMPLEMENT_RE,
      (full, keyword: string, ident: string | undefined) => {
        fragments.push(full.trim());
        const key = COMPLEMENT_KEY_MAP[keyword.toLowerCase()];
        if (key && ident) map[key] = ident;
        else if (key && !map[key]) map[key] = '';
        return ' ';
      },
    )
    .replace(/\s+/g, ' ')
    .trim();
  return { cleaned, fragments, map };
}

function mergeComplementos(
  a: ComplementosColombianos,
  b: ComplementosColombianos,
): ComplementosColombianos {
  const out: ComplementosColombianos = { ...a };
  for (const k of Object.keys(b) as Array<keyof ComplementosColombianos>) {
    if (b[k]) out[k] = b[k];
  }
  return out;
}

/** Area/rural named-segment detector (barrio, urbanización, conjunto, vereda, ...). */
function tryExtractAreaSegment(segment: string): {
  kind:
    | 'barrio'
    | 'urbanizacion'
    | 'conjunto'
    | 'corregimiento'
    | 'sector'
    | 'vereda'
    | 'finca'
    | 'km_via'
    | null;
  value?: string;
  km?: string;
  via?: string;
} {
  let m: RegExpMatchArray | null;
  if ((m = segment.match(/^barrio\s+(.+)$/i)))
    return { kind: 'barrio', value: m[1].trim() };
  if ((m = segment.match(/^urbanizaci[oó]n\s+(.+)$/i)))
    return { kind: 'urbanizacion', value: m[1].trim() };
  if ((m = segment.match(/^conjunto\s+(.+)$/i)))
    return { kind: 'conjunto', value: m[1].trim() };
  if ((m = segment.match(/^corregimiento\s+(.+)$/i)))
    return { kind: 'corregimiento', value: m[1].trim() };
  if ((m = segment.match(/^sector\s+(.+)$/i)))
    return { kind: 'sector', value: m[1].trim() };
  if ((m = segment.match(/^vereda\s+(.+)$/i)))
    return { kind: 'vereda', value: m[1].trim() };
  if ((m = segment.match(/^(?:finca|predio)\s+(.+)$/i)))
    return { kind: 'finca', value: m[1].trim() };
  if ((m = segment.match(/^km\.?\s*(\d+)\s+v[ií]a\s+(.+)$/i)))
    return { kind: 'km_via', km: m[1], via: m[2].trim() };
  return { kind: null };
}

interface MainParse {
  normalized: string;
  viaTipo: ViaTipo | null;
  viaNum: string | null;
  viaLetra: string | null;
  viaBis: string | null;
  viaCuadrante: string | null;
  cruceTipo: ViaTipo | null;
  cruceNum: string | null;
  cruceLetra: string | null;
  cruceBis: string | null;
  cruceCuadrante: string | null;
  placa: string | null;
  placaCuadrante: string | null;
  placaRangoFin: string | null;
  isDaneFormat: boolean;
  isInterseccion: boolean;
}

const EMPTY_MAIN: MainParse = {
  normalized: '',
  viaTipo: null,
  viaNum: null,
  viaLetra: null,
  viaBis: null,
  viaCuadrante: null,
  cruceTipo: null,
  cruceNum: null,
  cruceLetra: null,
  cruceBis: null,
  cruceCuadrante: null,
  placa: null,
  placaCuadrante: null,
  placaRangoFin: null,
  isDaneFormat: false,
  isInterseccion: false,
};

/** Parses the main address segment (via type + number + separator + cross/plate,
 * or a "con"/"y" intersection). Never throws. */
function parseMainSegment(cleaned: string): MainParse {
  if (!cleaned) return { ...EMPTY_MAIN };

  const viaMatch = matchViaTipo(cleaned);
  if (!viaMatch) {
    return { ...EMPTY_MAIN, normalized: cleaned };
  }
  const { tipo, consumed } = viaMatch;
  const rest = cleaned.slice(consumed).trim();

  // (1) DANE separator: "#", "No.", "N°", "Nro."
  const sepMatch = SEPARATOR_RE.exec(rest);
  if (sepMatch) {
    const viaNumRaw = rest.slice(0, sepMatch.index).trim();
    let afterSep = rest.slice(sepMatch.index + sepMatch[0].length).trim();

    let placaRangoFin: string | null = null;
    const alMatch = AL_RANGE_RE.exec(afterSep);
    if (alMatch) {
      const afterAl = afterSep.slice(alMatch.index + alMatch[0].length).trim();
      afterSep = afterSep.slice(0, alMatch.index).trim();
      const endSplit = splitCrossAndPlate(afterAl);
      placaRangoFin = parsePlacaTokens(endSplit.placa).placa;
    }

    const { cruceNum: cruceRaw, placa: placaRaw } =
      splitCrossAndPlate(afterSep);
    const via = parseViaNumberTokens(viaNumRaw);
    const cruce = parseViaNumberTokens(cruceRaw);
    const { placa, cuadrante: placaCuadrante } = parsePlacaTokens(placaRaw);

    const isDaneFormat = Boolean(via.num && cruce.num && placa);
    const viaNumFull = buildNumToken(
      via.num,
      via.letra,
      via.bis,
      via.cuadrante,
    );
    const cruceNumFull = buildNumToken(
      cruce.num,
      cruce.letra,
      cruce.bis,
      cruce.cuadrante,
    );
    const normalized = isDaneFormat
      ? `${tipo} ${viaNumFull} # ${cruceNumFull}-${placa}${placaCuadrante ? ' ' + placaCuadrante : ''}`
      : [tipo, viaNumFull].filter(Boolean).join(' ');

    return {
      normalized,
      viaTipo: tipo,
      viaNum: via.num,
      viaLetra: via.letra,
      viaBis: via.bis,
      viaCuadrante: via.cuadrante,
      cruceTipo: null,
      cruceNum: cruce.num,
      cruceLetra: cruce.letra,
      cruceBis: cruce.bis,
      cruceCuadrante: cruce.cuadrante,
      placa,
      placaCuadrante,
      placaRangoFin,
      isDaneFormat,
      isInterseccion: false,
    };
  }

  // (2) Intersection connector: "con"/"y"
  const conMatch = CON_Y_RE.exec(rest);
  if (conMatch) {
    const viaNumRaw = rest.slice(0, conMatch.index).trim();
    const afterConn = rest.slice(conMatch.index + conMatch[0].length).trim();
    const via = parseViaNumberTokens(viaNumRaw);

    const crossViaMatch = matchViaTipo(afterConn);
    const crossTipo = crossViaMatch?.tipo ?? null;
    const crossRest = crossViaMatch
      ? afterConn.slice(crossViaMatch.consumed).trim()
      : afterConn;
    // Unlike the DANE tail, a bare cross-street token with no dash is the
    // WHOLE cruceNum (no plate) — "Kr 26" is just "cruceNum = 26", not
    // "cruceNum = null, placa = 26".
    const dashIdx = crossRest.lastIndexOf('-');
    const cruceRaw =
      dashIdx >= 0 ? crossRest.slice(0, dashIdx).trim() : crossRest;
    const placaRaw = dashIdx >= 0 ? crossRest.slice(dashIdx + 1).trim() : null;
    const cruce = parseViaNumberTokens(cruceRaw || null);
    const { placa, cuadrante: placaCuadrante } = parsePlacaTokens(placaRaw);

    const viaNumFull = buildNumToken(
      via.num,
      via.letra,
      via.bis,
      via.cuadrante,
    );
    const cruceNumFull = buildNumToken(
      cruce.num,
      cruce.letra,
      cruce.bis,
      cruce.cuadrante,
    );
    const normalized =
      `${tipo} ${viaNumFull} con ${crossTipo ?? ''} ${cruceNumFull}`
        .replace(/\s+/g, ' ')
        .trim() + (placa ? ` - ${placa}` : '');

    return {
      normalized,
      viaTipo: tipo,
      viaNum: via.num,
      viaLetra: via.letra,
      viaBis: via.bis,
      viaCuadrante: via.cuadrante,
      cruceTipo: crossTipo,
      cruceNum: cruce.num,
      cruceLetra: cruce.letra,
      cruceBis: cruce.bis,
      cruceCuadrante: cruce.cuadrante,
      placa,
      placaCuadrante,
      placaRangoFin: null,
      isDaneFormat: false,
      isInterseccion: true,
    };
  }

  // (3) No separator at all: "Calle 14 26-13" (bare "<viaNum> <cruceNum>-<placa>").
  const noSepMatch = rest.match(
    /^(\d+[A-Za-z]?(?:\s+(?:bis|sur|norte|este|oeste))*)\s+(\d+[A-Za-z0-9]*\s*-\s*\d+[A-Za-z0-9]*)$/i,
  );
  if (noSepMatch) {
    const via = parseViaNumberTokens(noSepMatch[1]);
    const { cruceNum: cruceRaw, placa: placaRaw } = splitCrossAndPlate(
      noSepMatch[2],
    );
    const cruce = parseViaNumberTokens(cruceRaw);
    const { placa, cuadrante: placaCuadrante } = parsePlacaTokens(placaRaw);
    const isDaneFormat = Boolean(via.num && cruce.num && placa);
    const viaNumFull = buildNumToken(
      via.num,
      via.letra,
      via.bis,
      via.cuadrante,
    );
    const cruceNumFull = buildNumToken(
      cruce.num,
      cruce.letra,
      cruce.bis,
      cruce.cuadrante,
    );
    const normalized = `${tipo} ${viaNumFull} # ${cruceNumFull}-${placa}${
      placaCuadrante ? ' ' + placaCuadrante : ''
    }`;
    return {
      normalized,
      viaTipo: tipo,
      viaNum: via.num,
      viaLetra: via.letra,
      viaBis: via.bis,
      viaCuadrante: via.cuadrante,
      cruceTipo: null,
      cruceNum: cruce.num,
      cruceLetra: cruce.letra,
      cruceBis: cruce.bis,
      cruceCuadrante: cruce.cuadrante,
      placa,
      placaCuadrante,
      placaRangoFin: null,
      isDaneFormat,
      isInterseccion: false,
    };
  }

  // (4) Via type recognized but nothing else usable — keep expanded via type.
  const via = parseViaNumberTokens(rest);
  const viaNumFull = via.num
    ? buildNumToken(via.num, via.letra, via.bis, via.cuadrante)
    : rest || null;
  return {
    ...EMPTY_MAIN,
    normalized: rest ? `${tipo} ${rest}` : tipo,
    viaTipo: tipo,
    viaNum: viaNumFull,
  };
}

/**
 * Parses a Colombian address (street, intersection, rural or manzana form)
 * into structured DANE-ish parts. Never throws — an unparseable line comes
 * back with `kind: 'libre'` and every specific part null.
 */
export function normalizeColombianAddress(
  input: string,
): ParsedColombianAddress {
  const raw = input;
  let collapsed = input.replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();

  // Legacy-name parenthesis: "Avenida del Ferrocarril (Carrera 15) # 22 - 04"
  let legacyName: string | null = null;
  const parenMatch = collapsed.match(/^(.*?)\(([^)]+)\)\s*(.*)$/);
  if (parenMatch && matchViaTipo(parenMatch[2].trim())) {
    legacyName = parenMatch[1].trim().replace(/[.,]$/, '') || null;
    collapsed = `${parenMatch[2].trim()} ${parenMatch[3].trim()}`.trim();
  }

  const segments = collapsed
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  let mainSegment: string | null = segments[0] ?? null;
  const extraSegments = segments.slice(1);

  let barrio: string | null = null;
  let urbanizacion: string | null = null;
  let conjunto: string | null = null;
  const rural: RuralColombianAddress = {};
  let complementos: ComplementosColombianos = {};
  const complementFragments: string[] = [];

  const remainingSegments: string[] = [];

  // mainSegment may itself be an area/rural segment ("Km 7 Vía Tunja - Paipa").
  if (mainSegment) {
    const area = tryExtractAreaSegment(mainSegment);
    if (area.kind === 'km_via') {
      rural.km = area.km;
      rural.via = area.via;
      mainSegment = null;
    } else if (area.kind === 'barrio') {
      barrio = area.value ?? null;
      mainSegment = null;
    } else if (area.kind === 'urbanizacion') {
      urbanizacion = area.value ?? null;
      mainSegment = null;
    } else if (area.kind === 'conjunto') {
      conjunto = area.value ?? null;
      mainSegment = null;
    } else if (area.kind === 'corregimiento') {
      rural.corregimiento = area.value;
      mainSegment = null;
    } else if (area.kind === 'sector') {
      rural.sector = area.value;
      mainSegment = null;
    } else if (area.kind === 'vereda') {
      rural.vereda = area.value;
      mainSegment = null;
    } else if (area.kind === 'finca') {
      rural.finca = area.value;
      mainSegment = null;
    }
  }

  for (const seg of extraSegments) {
    if (COUNTRY_SEGMENT_RE.test(seg)) continue;
    const area = tryExtractAreaSegment(seg);
    if (area.kind === 'barrio') barrio = barrio ?? area.value ?? null;
    else if (area.kind === 'urbanizacion')
      urbanizacion = urbanizacion ?? area.value ?? null;
    else if (area.kind === 'conjunto')
      conjunto = conjunto ?? area.value ?? null;
    else if (area.kind === 'corregimiento')
      rural.corregimiento = rural.corregimiento ?? area.value;
    else if (area.kind === 'sector') rural.sector = rural.sector ?? area.value;
    else if (area.kind === 'vereda') rural.vereda = rural.vereda ?? area.value;
    else if (area.kind === 'finca') rural.finca = rural.finca ?? area.value;
    else if (area.kind === 'km_via') {
      rural.km = rural.km ?? area.km;
      rural.via = rural.via ?? area.via;
    } else {
      remainingSegments.push(seg);
    }
  }

  // Complement extraction: inline within mainSegment, plus any leftover
  // extra segments (e.g. "Torre 2 Apt 501", "Manzana C Casa 12").
  let cleanedMain = '';
  if (mainSegment) {
    const extracted = extractComplement(mainSegment);
    cleanedMain = extracted.cleaned;
    complementos = mergeComplementos(complementos, extracted.map);
    complementFragments.push(...extracted.fragments);
  }
  for (const seg of remainingSegments) {
    const extracted = extractComplement(seg);
    complementos = mergeComplementos(complementos, extracted.map);
    complementFragments.push(...extracted.fragments);
    // Any text not recognized as a complement keyword is noise we still want
    // to preserve for display (e.g. a free-form note) via the legacy field.
    if (extracted.cleaned && !extracted.fragments.length) {
      complementFragments.push(extracted.cleaned);
    }
  }

  const main = cleanedMain ? parseMainSegment(cleanedMain) : { ...EMPTY_MAIN };

  const hasRural = Boolean(
    rural.km ||
    rural.via ||
    rural.vereda ||
    rural.corregimiento ||
    rural.sector ||
    rural.finca,
  );

  let kind: AddressKind;
  if (hasRural) kind = 'rural';
  else if (main.isInterseccion) kind = 'interseccion';
  else if (main.isDaneFormat) kind = 'dane';
  else if (complementos.manzana && !main.viaTipo) kind = 'manzana';
  else kind = 'libre';

  let normalized = main.normalized;
  if (!normalized) {
    if (kind === 'rural') {
      const parts = [
        rural.km ? `Km ${rural.km}` : null,
        rural.via ? `Vía ${rural.via}` : null,
        rural.vereda ? `Vereda ${rural.vereda}` : null,
        rural.corregimiento ? `Corregimiento ${rural.corregimiento}` : null,
        rural.sector ? `Sector ${rural.sector}` : null,
        rural.finca ? `Finca ${rural.finca}` : null,
      ].filter(Boolean);
      normalized = parts.join(', ');
    } else if (kind === 'manzana') {
      const parts = [
        urbanizacion ? `Urbanización ${urbanizacion}` : null,
        complementos.manzana ? `Manzana ${complementos.manzana}` : null,
        complementos.casa ? `Casa ${complementos.casa}` : null,
        complementos.lote ? `Lote ${complementos.lote}` : null,
      ].filter(Boolean);
      normalized = parts.join(' ');
    } else {
      normalized = [barrio, urbanizacion, conjunto, cleanedMain || collapsed]
        .filter(Boolean)
        .join(', ');
    }
  }
  if (!normalized) normalized = collapsed;

  return {
    raw,
    normalized,
    kind,
    viaTipo: main.viaTipo,
    viaNum: main.viaNum,
    viaLetra: main.viaLetra,
    viaBis: main.viaBis,
    viaCuadrante: main.viaCuadrante,
    cruceTipo: main.cruceTipo,
    cruceNum: main.cruceNum,
    cruceLetra: main.cruceLetra,
    cruceBis: main.cruceBis,
    cruceCuadrante: main.cruceCuadrante,
    placa: main.placa,
    placaCuadrante: main.placaCuadrante,
    placaRangoFin: main.placaRangoFin,
    complementos,
    barrio,
    urbanizacion,
    conjunto,
    rural: hasRural ? rural : Object.keys(rural).length ? rural : null,
    legacyName,
    complement: complementFragments.length
      ? complementFragments.join(', ')
      : null,
    isDaneFormat: main.isDaneFormat,
  };
}

/**
 * Splits a free-text query the way the checkout/address-form-fields
 * frontend builds it (`[line, city, 'Colombia'].join(', ')`). A trailing
 * "Colombia"/"CO" segment is dropped.
 */
export function parseFreeTextQuery(q: string): ParsedFreeTextQuery {
  const parts = q
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return { addressLine: '', city: null, state: null };

  if (parts.length > 1 && COUNTRY_SEGMENT_RE.test(parts[parts.length - 1])) {
    parts.pop();
  }

  const [addressLine, city, state] = parts;
  return {
    addressLine: addressLine ?? '',
    city: city ?? null,
    state: state ?? null,
  };
}

/**
 * Axis of a via type for DANE intersection purposes: `calle` runs E-W
 * (Calle, Diagonal), `carrera` runs N-S (Carrera, Transversal). Ambiguous
 * types (bare Avenida, Circular, Circunvalar, Autopista, Vía) return null.
 */
export function viaTipoAxis(tipo: ViaTipo | null): 'calle' | 'carrera' | null {
  switch (tipo) {
    case 'Calle':
    case 'Diagonal':
    case 'Avenida Calle':
      return 'calle';
    case 'Carrera':
    case 'Transversal':
    case 'Avenida Carrera':
      return 'carrera';
    default:
      return null;
  }
}

/** The via type the DANE house number's cross axis is generated from. */
export function crossViaTipoLabel(
  tipo: ViaTipo | null,
): 'Calle' | 'Carrera' | null {
  const axis = viaTipoAxis(tipo);
  if (axis === 'calle') return 'Carrera';
  if (axis === 'carrera') return 'Calle';
  return null;
}

// --------------------------------------------------- Candidate selection

/** Subset of a Nominatim `addressdetails=1` `address` object we read. */
export interface GeocodeCandidateAddress {
  road?: string;
  house_number?: string;
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  county?: string;
  suburb?: string;
  neighbourhood?: string;
  state?: string;
  country_code?: string;
}

/** Subset of a Nominatim `/search` (jsonv2, addressdetails=1) result. */
export interface GeocodeCandidate {
  lat: string;
  lon: string;
  class?: string;
  type?: string;
  addresstype?: string;
  importance?: number;
  address?: GeocodeCandidateAddress;
  /** Nominatim `/search` boundingbox: [south, north, west, east] as strings. */
  boundingbox?: string[];
}

export type GeocodePrecision =
  | 'exact'
  | 'interpolated'
  | 'intersection'
  | 'street'
  | 'area';

const ADMIN_TYPES = new Set([
  'city',
  'town',
  'village',
  'municipality',
  'county',
  'state',
  'country',
  'administrative',
  'state_district',
  'region',
]);
const AREA_TYPES = new Set([
  'suburb',
  'neighbourhood',
  'quarter',
  'residential',
  'hamlet',
]);
const STREET_TYPES = new Set([
  'road',
  'pedestrian',
  'footway',
  'living_street',
  'unclassified',
]);

/**
 * OSM classes/addresstypes for named places (POIs: malls, markets, hospitals,
 * stations...). A POI result is the place itself, so its point is the
 * building/venue and counts as 'exact' rather than a neighbourhood-level 'area'.
 */
const POI_TYPES = new Set([
  'shop',
  'amenity',
  'building',
  'tourism',
  'leisure',
  'office',
  'healthcare',
  'craft',
  'historic',
  'man_made',
  'public_transport',
  'railway',
  'aeroway',
  'emergency',
  'club',
  'sport',
]);

function classifyCandidate(
  candidate: GeocodeCandidate,
): 'exact' | 'street' | 'area' | 'admin' {
  const t = (candidate.addresstype || candidate.type || '').toLowerCase();
  if (t === 'house' || candidate.address?.house_number) return 'exact';
  if (STREET_TYPES.has(t) || candidate.class === 'highway') return 'street';
  const cls = (candidate.class || '').toLowerCase();
  const at = (candidate.addresstype || '').toLowerCase();
  if (POI_TYPES.has(cls) || POI_TYPES.has(at)) return 'exact';
  if (AREA_TYPES.has(t)) return 'area';
  if (ADMIN_TYPES.has(t)) return 'admin';
  return 'area';
}

function candidateCity(candidate: GeocodeCandidate): string | null {
  const a = candidate.address;
  return (
    a?.city ?? a?.town ?? a?.village ?? a?.municipality ?? a?.county ?? null
  );
}

/**
 * Picks the best geocoding candidate out of a Nominatim `addressdetails=1`
 * result list for a STREET-level query. City/town/state/country-only
 * matches are discarded outright. Among the rest: exact (house-numbered) >
 * street > area, tie-broken by city match then by Nominatim `importance`.
 * Returns null when nothing usable remains.
 */
export function selectBestCandidate(
  candidates: GeocodeCandidate[],
  wantedCity?: string | null,
): { candidate: GeocodeCandidate; precision: GeocodePrecision } | null {
  const RANK: Record<'exact' | 'street' | 'area', number> = {
    exact: 3,
    street: 2,
    area: 1,
  };
  const wanted = wantedCity ? normText(wantedCity) : null;

  let best: {
    candidate: GeocodeCandidate;
    kind: 'exact' | 'street' | 'area';
    cityMatch: boolean;
  } | null = null;

  for (const candidate of candidates) {
    const kind = classifyCandidate(candidate);
    if (kind === 'admin') continue;

    const lat = Number(candidate.lat);
    const lon = Number(candidate.lon);
    if (
      !candidate.lat ||
      !candidate.lon ||
      Number.isNaN(lat) ||
      Number.isNaN(lon)
    )
      continue;

    const cityMatch = wanted
      ? normText(candidateCity(candidate) ?? '') === wanted
      : false;

    if (
      !best ||
      RANK[kind] > RANK[best.kind] ||
      (RANK[kind] === RANK[best.kind] && cityMatch && !best.cityMatch) ||
      (RANK[kind] === RANK[best.kind] &&
        cityMatch === best.cityMatch &&
        (candidate.importance ?? 0) > (best.candidate.importance ?? 0))
    ) {
      best = { candidate, kind, cityMatch };
    }
  }

  if (!best) return null;
  return { candidate: best.candidate, precision: best.kind };
}
