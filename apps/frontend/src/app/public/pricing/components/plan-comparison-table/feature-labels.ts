/**
 * Map of `ai_features` keys (and selected `feature_matrix` keys) to their
 * Spanish human label, displayed in the public pricing comparison table.
 *
 * Keys mirror:
 *   - `AIFeatureKey` from apps/backend/src/domains/store/subscriptions/types/access.types.ts
 *   - inner caps fields from `FeatureConfig` (monthly_tokens_cap, etc.)
 *   - common feature_matrix keys from prisma/seeds/subscription-plans-production.seed.ts
 *
 * Anything not in this map falls back to a humanized version of the key
 * (snake_case -> Title Case in Spanish).
 */
export const FEATURE_LABELS: Record<string, string> = {
  // AI feature group labels
  text_generation: 'Generación de texto IA',
  streaming_chat: 'Chat IA en streaming',
  conversations: 'Historial de conversaciones',
  tool_agents: 'Agentes con herramientas',
  rag_embeddings: 'Búsqueda semántica (RAG)',
  async_queue: 'Cola async para IA',

  // AI sub-fields (caps / quotas)
  monthly_tokens_cap: 'Tokens IA por mes',
  daily_messages_cap: 'Mensajes de chat diarios',
  retention_days: 'Días de retención de chats',
  indexed_docs_cap: 'Documentos RAG indexados',
  monthly_jobs_cap: 'Jobs async por mes',
  tools_allowed: 'Herramientas permitidas',
  degradation: 'Modo de degradación',

  // feature_matrix top-level (informational; reserved for future expansion)
  pos: 'Punto de venta (POS)',
  ecommerce: 'Tienda online',
  accounting: 'Contabilidad',
  inventory: 'Inventario',
  inventory_advanced: 'Inventario avanzado',
  integrations: 'Integraciones',
  stores: 'Tiendas',
  users: 'Usuarios',
  support: 'Soporte',
};

/**
 * Capitalize and replace underscores when no explicit label is mapped.
 */
export function humanizeFeatureKey(key: string): string {
  if (FEATURE_LABELS[key]) return FEATURE_LABELS[key];
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
