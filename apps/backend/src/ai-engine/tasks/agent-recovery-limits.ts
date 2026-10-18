/** Numeric recovery budgets retain bounded defaults for standard execution. */

const boundedRecoveryLimit = (key: string): number => {
  const value = Number(process.env[key] ?? 2);
  return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 8) : 2;
};
export const maximumRecoveryReplans = (): number =>
  boundedRecoveryLimit('AI_AGENT_MAX_TECHNICAL_REPLANS');
export const maximumCatalogExpansions = (): number =>
  boundedRecoveryLimit('AI_AGENT_MAX_CATALOG_EXPANSIONS');
