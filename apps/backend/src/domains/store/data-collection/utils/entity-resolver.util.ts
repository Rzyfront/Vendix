export interface EntityContext {
  customer_id?: number | null;
  booking_id?: number | null;
  order_id?: number | null;
}

/**
 * Resolves the entity_id for a metadata field based on its entity_type scope.
 * Returns null if the entity_id cannot be resolved from the context.
 */
export function resolveEntityId(
  fieldEntityType: string,
  ctx: EntityContext,
): number | null {
  switch (fieldEntityType) {
    case 'customer':
      return ctx.customer_id ?? null;
    case 'booking':
      return ctx.booking_id ?? null;
    case 'order':
      return ctx.order_id ?? null;
    default:
      return null;
  }
}

/**
 * Builds the list of entity queries needed to load all metadata values
 * relevant to a given context. Used when populating form responses.
 */
export function buildEntityQueries(
  ctx: EntityContext,
): Array<{ entityType: string; entityId: number }> {
  const queries: Array<{ entityType: string; entityId: number }> = [];
  if (ctx.customer_id)
    queries.push({ entityType: 'customer', entityId: ctx.customer_id });
  if (ctx.booking_id)
    queries.push({ entityType: 'booking', entityId: ctx.booking_id });
  if (ctx.order_id)
    queries.push({ entityType: 'order', entityId: ctx.order_id });
  return queries;
}
