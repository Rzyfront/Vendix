import type { AIFeatureKey } from '../types/access.types';

/**
 * Grupos de consumo IA visibles para el comerciante en "Mi suscripcion".
 * Regla de negocio: el consumo real sale de `ai_engine_logs` (no de los
 * contadores Redis) y se agrupa por la app que lo genero.
 */
export const AI_USAGE_GROUPS = [
  'assistant',
  'vex',
  'text_generation',
  'jobs',
  'semantic_search',
  'voice',
] as const;

export type AiUsageGroup = (typeof AI_USAGE_GROUPS)[number];

export type AiUsageUnit = 'messages' | 'tokens' | 'jobs' | 'docs' | 'seconds';

/** grupo -> feature de cuota Redis (null = sin barra) y unidad */
export const USAGE_GROUP_QUOTA: Record<
  AiUsageGroup,
  { feature: AIFeatureKey; unit: AiUsageUnit } | null
> = {
  assistant: { feature: 'streaming_chat', unit: 'messages' },
  vex: null,
  text_generation: { feature: 'text_generation', unit: 'tokens' },
  jobs: { feature: 'async_queue', unit: 'jobs' },
  semantic_search: { feature: 'rag_embeddings', unit: 'docs' },
  voice: { feature: 'realtime_voice', unit: 'seconds' },
};

/**
 * Asigna una app de IA a su grupo visible. Orden de reglas:
 * chat_assistant -> assistant; vex_* (salvo voz) -> vex; categoria
 * realtime_voice -> voice; async_queue -> jobs; rag_embeddings ->
 * semantic_search; conversations -> assistant; el resto -> text_generation.
 */
export function resolveUsageGroup(
  appKey: string | null,
  featureCategory: string | null,
): AiUsageGroup {
  if (appKey === 'chat_assistant') return 'assistant';
  if (
    (appKey === 'vex_assistant' || appKey?.startsWith('vex_')) &&
    featureCategory !== 'realtime_voice'
  ) {
    return 'vex';
  }
  switch (featureCategory) {
    case 'realtime_voice':
      return 'voice';
    case 'async_queue':
      return 'jobs';
    case 'rag_embeddings':
      return 'semantic_search';
    case 'conversations':
      return 'assistant';
    default:
      return 'text_generation';
  }
}
