import { VEX_COPY } from '../vex-copy';

/** Ids the server may send for a welcome suggestion (`GET /store/vex/suggestions`). */
export type VexSuggestionId = keyof typeof VEX_COPY.welcome.suggestions;

export interface VexServerSuggestion {
  id: string;
  count?: number;
}

/** A suggestion ready for the welcome screen. */
export interface VexWelcomeSuggestion {
  id: VexSuggestionId;
  /** Text on the chip. */
  label: string;
  /** Message sent to Vex when the chip is pressed. */
  prompt: string;
}

/** Shown while the store's suggestions load, and when they cannot be read. */
export const VEX_DEFAULT_SUGGESTION_IDS: VexSuggestionId[] = [
  'sales_today',
  'top_products',
  'overdue_receivables',
];

function isKnown(id: string): id is VexSuggestionId {
  return Object.prototype.hasOwnProperty.call(VEX_COPY.welcome.suggestions, id);
}

/**
 * Server ids → chips. Unknown ids are dropped (an older client must not show
 * an empty chip); an empty or missing answer falls back to the defaults.
 */
export function resolveWelcomeSuggestions(
  server: readonly VexServerSuggestion[] | null | undefined,
): VexWelcomeSuggestion[] {
  const known = (server ?? []).filter((item) => isKnown(item.id));
  const source: VexServerSuggestion[] =
    known.length > 0 ? known : VEX_DEFAULT_SUGGESTION_IDS.map((id) => ({ id }));
  const seen = new Set<string>();
  const result: VexWelcomeSuggestion[] = [];
  for (const item of source) {
    if (seen.has(item.id) || !isKnown(item.id)) continue;
    seen.add(item.id);
    const copy = VEX_COPY.welcome.suggestions[item.id];
    result.push({ id: item.id, label: copy.label, prompt: copy.prompt });
  }
  return result;
}
