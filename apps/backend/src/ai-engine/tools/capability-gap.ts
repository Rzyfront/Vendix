import type { RegisteredTool } from './interfaces/tool.interface';
import { TOOL_DISCOVERY_QUERIES_ES } from './tool-discovery-queries.es';

/**
 * T6 — strong validation before a capability ticket.
 *
 * A capability ticket is only honest when Vendix really lacks the capability.
 * Before one exists, the person's request is swept against the WHOLE release
 * catalog (native tools with their descriptions, synonyms and synthetic
 * queries, plus the HTTP bridge routes), not against the turn's working set:
 * a tool the role cannot use is a permission problem, never a missing
 * capability. Any partial match blocks the ticket.
 *
 * Individual and bulk variants collapse on purpose: quantity words («todos»,
 * «varios», «masivo») and generic verbs («aplicar», «cambiar», «poner») are
 * dropped, so «aplicar tarifa a todos mis productos» and «aplicar tarifa a un
 * producto» look for the same nouns. Pure and deterministic: no DB, no LLM.
 */

/** One searchable capability of the release. */
export interface CapabilityCorpusEntry {
  kind: 'tool' | 'route';
  /** Tool name, or `METHOD path` for a bridge route. */
  name: string;
  domain: string;
  /** Free text the tokens are read from. */
  text: string;
  /** Whether the current caller may use it (false = permission problem). */
  permitted: boolean;
}

export interface CapabilityMatch {
  kind: CapabilityCorpusEntry['kind'];
  name: string;
  domain: string;
  permitted: boolean;
  /** Intent stems found in the entry. */
  matched: string[];
  score: number;
}

/** Stems are this long: «producto»/«productos» → «produ», «tarifa(s)» → «tarif». */
const STEM_LENGTH = 5;

/**
 * Words that carry no capability: articles, prepositions, pronouns, quantity
 * and politeness words, and the generic verbs a request starts with. Compared
 * after accent folding, by full word.
 */
const NOISE_WORDS = new Set(
  [
    // articles, prepositions, conjunctions, pronouns
    'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'lo', 'al', 'del',
    'de', 'a', 'en', 'con', 'por', 'para', 'sin', 'sobre', 'entre', 'y', 'o',
    'u', 'e', 'que', 'se', 'me', 'te', 'le', 'les', 'nos', 'mi', 'mis', 'tu',
    'tus', 'su', 'sus', 'este', 'esta', 'estos', 'estas', 'ese', 'esa', 'esos',
    'esas', 'eso', 'esto', 'aqui', 'ahi', 'alla', 'como', 'cuando', 'donde',
    'quiero', 'quisiera', 'necesito', 'puedes', 'podrias', 'favor', 'porfa',
    'porfavor', 'oe', 'parce', 'hola', 'gracias', 'ya', 'si', 'no', 'mas',
    'muy', 'tambien',
    // quantity: individual and bulk variants look alike
    'todo', 'todos', 'toda', 'todas', 'cada', 'varios', 'varias', 'algunos',
    'algunas', 'masivo', 'masiva', 'masivamente', 'lote', 'lotes', 'uno',
    'solo', 'mismo', 'misma',
    // generic verbs (and their common clitic forms)
    'aplicar', 'aplica', 'aplicale', 'aplicales', 'aplicame', 'aplique',
    'cambiar', 'cambia', 'cambiame', 'cambiale', 'cambie', 'poner', 'pon',
    'ponle', 'ponles', 'ponme', 'hacer', 'haz', 'hazme', 'hacerlo', 'crear',
    'crea', 'creame', 'hazlo', 'hagalo', 'hacelo', 'quitar', 'quita',
    'quitale', 'quitales', 'agregar',
    'agrega', 'agregale', 'anadir', 'anade', 'actualizar', 'actualiza',
    'actualizame', 'modificar', 'modifica', 'editar', 'edita', 'ver', 'mira',
    'mostrar', 'muestra', 'muestrame', 'dame', 'dar', 'tener', 'tiene',
    'tienen', 'usar', 'usa', 'asignar', 'asigna', 'asignale', 'habilitar',
    'habilita', 'activar', 'activa', 'configurar', 'configura', 'dejar',
    'deja', 'dejalo', 'sea', 'sean', 'quede', 'queden', 'puedo', 'puede',
    'hay',
  ].map(fold),
);

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Content stems of a text, deduplicated, in order of appearance. */
export function capabilityStems(text: string): string[] {
  const out: string[] = [];
  for (const raw of fold(text).split(/[^a-z0-9ñ]+/)) {
    if (raw.length < 3 || NOISE_WORDS.has(raw) || /^\d+$/.test(raw)) continue;
    const stem = raw.slice(0, STEM_LENGTH);
    if (!out.includes(stem)) out.push(stem);
  }
  return out;
}

/** Minimum share of the intent's stems an entry must hold to count. */
const MIN_COVERAGE = 0.6;

/**
 * Entries that already (even partially) cover the intent, best first. An
 * entry counts when it holds at least two of the intent's content stems (one
 * when the intent has a single one) and at least 60 % of them.
 */
export function findExistingCapabilities(
  intent: string,
  corpus: readonly CapabilityCorpusEntry[],
  limit = 5,
): CapabilityMatch[] {
  const wanted = capabilityStems(intent);
  if (!wanted.length) return [];
  const needed = Math.max(
    Math.min(2, wanted.length),
    Math.ceil(wanted.length * MIN_COVERAGE),
  );
  const matches: CapabilityMatch[] = [];
  for (const entry of corpus) {
    const have = new Set(capabilityStems(`${entry.name} ${entry.text}`));
    const matched = wanted.filter((stem) => have.has(stem));
    if (matched.length < needed) continue;
    matches.push({
      kind: entry.kind,
      name: entry.name,
      domain: entry.domain,
      permitted: entry.permitted,
      matched,
      score: matched.length / wanted.length,
    });
  }
  return matches
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.permitted) - Number(a.permitted) ||
        (a.kind === b.kind ? 0 : a.kind === 'tool' ? -1 : 1) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, limit);
}

/** Domains that are agent plumbing, not business capabilities. */
const NON_CAPABILITY_DOMAINS = new Set([
  'discovery',
  'capabilities',
  'capability_requests',
  'vex_batches',
  'turn',
  'ui',
]);

/**
 * Searchable text of a native tool: name, description, discovery synonyms and
 * the versioned synthetic queries people use to ask for it.
 */
export function toolCorpusEntry(
  tool: RegisteredTool,
  permitted: boolean,
): CapabilityCorpusEntry | null {
  if (NON_CAPABILITY_DOMAINS.has(tool.domain) || tool.clientSide) return null;
  const synonyms = tool.discovery?.synonyms ?? [];
  const queries = TOOL_DISCOVERY_QUERIES_ES[tool.name] ?? [];
  return {
    kind: 'tool',
    name: tool.name,
    domain: tool.domain,
    text: [
      tool.name.replace(/_/g, ' '),
      tool.description,
      ...synonyms,
      ...queries,
    ].join(' '),
    permitted,
  };
}

/** The pieces of the registry and the route catalog the corpus reads. */
export interface CapabilityCorpusSources {
  tools: () => RegisteredTool[];
  /** Names of the tools the current caller may use. */
  permittedToolNames: () => ReadonlySet<string>;
  /** Every route of the release (existence, not reach). */
  routes: () => Array<{
    method: string;
    path: string;
    domain: string;
    summary?: string;
  }>;
  /** `METHOD path` of the routes the current caller may call. */
  permittedRouteKeys: () => ReadonlySet<string>;
}

/** The whole release, each entry flagged with the caller's reach. */
export function buildCapabilityCorpus(
  sources: CapabilityCorpusSources,
): CapabilityCorpusEntry[] {
  const permittedTools = sources.permittedToolNames();
  const permittedRoutes = sources.permittedRouteKeys();
  const corpus: CapabilityCorpusEntry[] = [];
  for (const tool of sources.tools()) {
    const entry = toolCorpusEntry(tool, permittedTools.has(tool.name));
    if (entry) corpus.push(entry);
  }
  for (const route of sources.routes()) {
    const key = `${route.method} ${route.path}`;
    corpus.push({
      kind: 'route',
      name: key,
      domain: route.domain,
      // Path segments carry the subject («price-tiers», «products»).
      text: `${route.path.replace(/[/:_-]+/g, ' ')} ${route.summary ?? ''}`,
      permitted: permittedRoutes.has(key),
    });
  }
  return corpus;
}
