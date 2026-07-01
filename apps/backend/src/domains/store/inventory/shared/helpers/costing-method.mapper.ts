/**
 * Mapping between backend `ResolvedCostingMethod` and the public UI vocabulary.
 *
 * Backend vocabulary (from `CostingMethodResolverService`):
 *   - `'weighted_average' | 'fifo'`
 *
 * Public UI vocabulary (frontend `CostPreviewResponse.costing_method`,
 * store settings DTO, etc.):
 *   - `'cpp' | 'fifo'`
 *
 * `'cpp'` is the legacy store-level alias for weighted average
 * (Plan Unificado §13 #7). LIFO is rejected at the DTO layer and mapped to
 * `weighted_average` defensively by the resolver, so by the time we reach
 * this mapper the input is guaranteed to be one of `'weighted_average' |
 * 'fifo'`.
 *
 * Use this helper any time backend code returns `costing_method` to a public
 * API consumer (REST/SSE/queue payload) so we don't leak the resolver
 * vocabulary to the frontend.
 */
import { ResolvedCostingMethod } from '../services/costing-method-resolver.service';

export type PublicCostingMethod = 'cpp' | 'fifo';

export function toPublicCostingMethod(
  method: ResolvedCostingMethod,
): PublicCostingMethod {
  return method === 'weighted_average' ? 'cpp' : 'fifo';
}