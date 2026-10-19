/** Numeric recovery budgets retain bounded defaults for standard execution. */

const boundedRecoveryLimit = (key: string): number => {
  const value = Number(process.env[key] ?? 2);
  return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 8) : 2;
};
export const maximumRecoveryReplans = (): number =>
  boundedRecoveryLimit('AI_AGENT_MAX_TECHNICAL_REPLANS');
export const maximumCatalogExpansions = (): number =>
  boundedRecoveryLimit('AI_AGENT_MAX_CATALOG_EXPANSIONS');

/**
 * Inferences that follow a round with ONLY tool discovery (search_tools, a
 * hallucinated name answered with alternatives, or invalid args on a tool
 * loaded by the hard rule) do not count against max_iterations, up to this
 * many per turn; after that they count normally (no discovery loops).
 */
export const FREE_DISCOVERY_ROUNDS_PER_TURN = 3;
