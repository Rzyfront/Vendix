/**
 * Pure, dependency-free helpers for parsing and normalizing Colombian street
 * addresses written in DANE nomenclature (e.g. "Calle 45 # 12-30"), plus
 * candidate selection for Nominatim `/search` results.
 *
 * Everything here is a plain string/data transform — no network, no Redis,
 * no NestJS DI — which is what makes it unit-testable in isolation (see
 * `colombian-address.util.spec.ts`) instead of only through mocked-fetch
 * integration tests of `GeocodingService`.
 */

/** Canonical via-type labels this module normalizes abbreviations into. */
export type ViaTipo =
  | 'Calle'
  | 'Carrera'
  | 'Avenida'
  | 'Avenida Calle'
  | 'Avenida Carrera'
  | 'Diagonal'
  | 'Transversal';

export interface ParsedColombianAddress {
  /** Original input, unmodified. */
  raw: string;
  /**
   * Canonical rebuilt line: abbreviations expanded, complement stripped,
   * "No./N°/Nro." collapsed to "#". Safe to feed to Nominatim `street=` or a
   * free-text `q=`. Falls back to a whitespace-collapsed `raw` when no via
   * type is recognized at all.
   */
  normalized: string;
  /** Recognized main via type, or null when the text has no via type. */
  viaTipo: ViaTipo | null;
  /** Main via number/name — may carry a letter suffix, "Bis", "Sur"... */
  viaNum: string | null;
  /** Generating/cross via number (DANE: the value before the last dash). */
  cruceNum: string | null;
  /** House plate (DANE: the value after the last dash). */
  placa: string | null;
  /** Stripped complement (apto/torre/interior/casa/piso/bloque/local...). */
  complement: string | null;
  /** True only when viaTipo + viaNum + cruceNum + placa all resolved. */
  isDaneFormat: boolean;
}

export interface ParsedFreeTextQuery {
  /** First comma-separated segment — the street line. */
  addressLine: string;
  city: string | null;
  state: string | null;
}

const ORIENTATION_WORDS = new Set(['sur', 'norte', 'este', 'oeste', 'bis']);

/**
 * Via-type matchers, longest/most-specific literal first so a compound like
 * "Avenida Carrera" or an ambiguous-prefix abbreviation ("Av" vs "Ak") never
 * gets shadowed by a shorter alternative tried earlier. Each pattern is
 * anchored at the start of the (already trimmed) string and requires the
 * abbreviation to be followed by whitespace or end-of-string, so it never
 * matches mid-word (e.g. `av` inside "avenida" is never reached because
 * "avenida" itself is tried first; `ac` never matches "Acacia").
 */
const VIA_TIPO_TABLE: Array<{ re: RegExp; tipo: ViaTipo }> = [
  { re: /^avenida\s+carrera(?=\s|$)/i, tipo: 'Avenida Carrera' },
  { re: /^avenida\s+calle(?=\s|$)/i, tipo: 'Avenida Calle' },
  { re: /^av\.?\s*cra\.?(?=\s|$)/i, tipo: 'Avenida Carrera' },
  { re: /^av\.?\s*cl\.?(?=\s|$)/i, tipo: 'Avenida Calle' },
  { re: /^ak(?=\s|$)/i, tipo: 'Avenida Carrera' },
  { re: /^ac(?=\s|$)/i, tipo: 'Avenida Calle' },
  { re: /^avenida(?=\s|$)/i, tipo: 'Avenida' },
  { re: /^avda\.?(?=\s|$)/i, tipo: 'Avenida' },
  { re: /^av\.?(?=\s|$)/i, tipo: 'Avenida' },
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
];

/**
 * DANE house-number separator: "#", "No.", "N°" or "Nro." — ONLY when
 * immediately (ignoring spaces) followed by a digit. That lookahead is what
 * keeps `No` from swallowing "Norte"/"Nogal" and similar words that merely
 * start with the same two letters.
 */
const SEPARATOR_RE = /\b(?:No|Nro)\.?\s*(?=\d)|N°\s*(?=\d)|#\s*(?=\d)/i;

/**
 * Complement keywords to strip out of the address line before geocoding
 * (apto/torre/interior/casa/piso/bloque/local and common abbreviations).
 * Longer literal forms are listed before the abbreviation that shares their
 * prefix ("interior" before "int", "torre" before "tor") so the alternation
 * — which JS tries left-to-right and stops at the first match — never
 * truncates a full word into its own abbreviation.
 */
const COMPLEMENT_RE =
  /\b(apartamento|apto|torre|tor|interior|int|casa|piso|bloque|bl|local|lc|manzana|mz|edificio|ed)\.?\s*([a-z0-9]+)?/gi;

const COUNTRY_SEGMENT_RE = /^\s*(colombia|co)\s*$/i;

/** Accent-insensitive, lowercased normalization for comparisons. */
function normText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
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

function findSeparator(text: string): { index: number; length: number } | null {
  const m = SEPARATOR_RE.exec(text);
  if (!m) return null;
  return { index: m.index, length: m[0].length };
}

/**
 * Splits a DANE cross/plate tail ("12-30", "12 - 30") using the LAST dash so
 * a plate with an internal dash (interior/apto suffix) stays on the plate
 * side — mirrors `GeocodingService.decomposeHouseNumber`.
 */
function splitCrossAndPlate(tail: string): {
  cruceNum: string | null;
  placa: string | null;
} {
  const trimmed = tail.trim();
  if (!trimmed) return { cruceNum: null, placa: null };
  const dash = trimmed.lastIndexOf('-');
  if (dash < 0) return { cruceNum: null, placa: trimmed || null };
  return {
    cruceNum: trimmed.slice(0, dash).trim() || null,
    placa: trimmed.slice(dash + 1).trim() || null,
  };
}

/**
 * Normalizes a single DANE token: uppercases a trailing single-letter suffix
 * ("45a" -> "45A") and title-cases orientation words ("sur" -> "Sur",
 * "bis" -> "Bis"). Named tokens (e.g. "Boyacá") pass through unchanged.
 */
function normalizeToken(token: string): string {
  return token
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase();
      if (ORIENTATION_WORDS.has(lower)) {
        return lower.charAt(0).toUpperCase() + lower.slice(1);
      }
      const m = word.match(/^(\d+)([a-zA-Z])$/);
      if (m) return `${m[1]}${m[2].toUpperCase()}`;
      return word;
    })
    .join(' ');
}

/**
 * Strips address complements (apto/torre/interior/casa/piso/bloque/local)
 * out of the line so they never pollute a geocoding query, returning them
 * separately so callers can still show/store them if needed.
 */
function extractComplement(text: string): {
  cleaned: string;
  complement: string | null;
} {
  const found: string[] = [];
  const cleaned = text
    .replace(COMPLEMENT_RE, (full) => {
      found.push(full.trim());
      return ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();
  return { cleaned, complement: found.length ? found.join(', ') : null };
}

/**
 * Parses a Colombian street address into DANE nomenclature parts. Never
 * throws — an unparseable line simply comes back with `isDaneFormat: false`
 * and every part but `raw`/`normalized`/`complement` set to null.
 */
export function normalizeColombianAddress(input: string): ParsedColombianAddress {
  const raw = input;
  const collapsed = input.replace(/\s+/g, ' ').trim();
  const { cleaned, complement } = extractComplement(collapsed);

  const viaMatch = matchViaTipo(cleaned);
  if (!viaMatch) {
    return {
      raw,
      normalized: cleaned,
      viaTipo: null,
      viaNum: null,
      cruceNum: null,
      placa: null,
      complement,
      isDaneFormat: false,
    };
  }

  const { tipo, consumed } = viaMatch;
  const rest = cleaned.slice(consumed).trim();

  const sep = findSeparator(rest);
  if (!sep) {
    // Via type recognized but no house-number marker found — keep the
    // expanded via type with whatever text follows it (e.g. a named avenue
    // with no cross number yet).
    return {
      raw,
      normalized: rest ? `${tipo} ${rest}` : tipo,
      viaTipo: tipo,
      viaNum: rest || null,
      cruceNum: null,
      placa: null,
      complement,
      isDaneFormat: false,
    };
  }

  const viaNumRaw = rest.slice(0, sep.index).trim();
  const afterSep = rest.slice(sep.index + sep.length).trim();
  const { cruceNum: cruceRaw, placa: placaRaw } = splitCrossAndPlate(afterSep);

  const viaNum = viaNumRaw ? normalizeToken(viaNumRaw) : null;
  const cruceNum = cruceRaw ? normalizeToken(cruceRaw) : null;
  const placa = placaRaw ? normalizeToken(placaRaw) : null;

  const isDaneFormat = Boolean(viaNum && cruceNum && placa);
  const normalized = isDaneFormat
    ? `${tipo} ${viaNum} # ${cruceNum}-${placa}`
    : [tipo, viaNum].filter(Boolean).join(' ');

  return {
    raw,
    normalized,
    viaTipo: tipo,
    viaNum,
    cruceNum,
    placa,
    complement,
    isDaneFormat,
  };
}

/**
 * Splits a free-text query the way the checkout/address-form-fields
 * frontend builds it (`[line, city, 'Colombia'].join(', ')`, and tolerates
 * the wider `line, city, department, Colombia` shape too). A trailing
 * "Colombia"/"CO" segment is dropped — it carries no extra signal beyond
 * `countrycodes=co`, which every Nominatim call already sets.
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
 * (Calle, Diagonal), `carrera` runs N-S (Carrera, Transversal). A bare
 * "Avenida" is ambiguous on its own (it can run either way) and returns
 * null; "Avenida Calle"/"Avenida Carrera" resolve like their plain
 * counterpart.
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
export function crossViaTipoLabel(tipo: ViaTipo | null): 'Calle' | 'Carrera' | null {
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
  /** Present on newer Nominatim responses; falls back to `type` when absent. */
  addresstype?: string;
  address?: GeocodeCandidateAddress;
}

export type GeocodePrecision = 'exact' | 'intersection' | 'street' | 'area';

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

function classifyCandidate(
  candidate: GeocodeCandidate,
): 'exact' | 'street' | 'area' | 'admin' {
  const t = (candidate.addresstype || candidate.type || '').toLowerCase();
  if (t === 'house' || candidate.address?.house_number) return 'exact';
  if (STREET_TYPES.has(t) || candidate.class === 'highway') return 'street';
  if (AREA_TYPES.has(t)) return 'area';
  if (ADMIN_TYPES.has(t)) return 'admin';
  // Unknown/unclassified type: never promote to exact/street, but still
  // usable as a last-resort 'area' match rather than being discarded.
  return 'area';
}

function candidateCity(candidate: GeocodeCandidate): string | null {
  const a = candidate.address;
  return a?.city ?? a?.town ?? a?.village ?? a?.municipality ?? a?.county ?? null;
}

/**
 * Picks the best geocoding candidate out of a Nominatim `addressdetails=1`
 * result list for a STREET-level query. City/town/state/country-only
 * matches are discarded outright: for shipping-by-distance, a bare city
 * centroid is materially wrong, so "not found" is preferred over a silently
 * wrong point. Among the rest: exact (house-numbered) > street > area
 * (barrio/suburb, last resort), tie-broken by whether the candidate's own
 * city matches `wantedCity` (when given) — Nominatim already returns
 * results in relevance order, so a stable tie stays with the first (best
 * ranked) candidate of that kind. Returns null when nothing usable remains.
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
    if (kind === 'admin') continue; // never usable for a street-level request

    const lat = Number(candidate.lat);
    const lon = Number(candidate.lon);
    if (!candidate.lat || !candidate.lon || Number.isNaN(lat) || Number.isNaN(lon)) {
      continue;
    }

    const cityMatch = wanted
      ? normText(candidateCity(candidate) ?? '') === wanted
      : false;

    if (
      !best ||
      RANK[kind] > RANK[best.kind] ||
      (RANK[kind] === RANK[best.kind] && cityMatch && !best.cityMatch)
    ) {
      best = { candidate, kind, cityMatch };
    }
  }

  if (!best) return null;
  return { candidate: best.candidate, precision: best.kind };
}
