/** D2 flags are independent kill switches; never enable D1/C implicitly. */
export const robustExecutionEnabled = (): boolean =>
  process.env.AI_AGENT_ROBUST_EXECUTION_ENABLED === 'true';
export const parallelReadsEnabled = (): boolean =>
  process.env.AI_PARALLEL_READS_ENABLED === 'true';

const boundedRecoveryLimit = (key: string): number => {
  const value = Number(process.env[key] ?? 2);
  return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 8) : 2;
};
export const maximumRecoveryReplans = (): number =>
  boundedRecoveryLimit('AI_AGENT_MAX_TECHNICAL_REPLANS');
export const maximumCatalogExpansions = (): number =>
  boundedRecoveryLimit('AI_AGENT_MAX_CATALOG_EXPANSIONS');
