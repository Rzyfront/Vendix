/**
 * Models for the stock-sourcing suggestion flow used by the POS when a sale
 * line cannot be fulfilled from the in-scope inventory (e.g. main location).
 *
 * The backend endpoint contract is:
 *   GET /api/v1/store/inventory/stock-levels/sourcing-suggestion
 * with the following response shape (under the standard ResponseService
 * `data` envelope handled by HTTP services).
 */

/**
 * One physical location with the quantity available there for the requested
 * product / variant pair.
 */
export interface StockSourcingLocation {
  id: number;
  name: string;
  quantity_available: number;
}

/**
 * Suggestion the backend computed for the caller given the requested quantity:
 * - `available`: in-scope stock already covers the request (race condition).
 * - `transfer`: other locations have enough combined stock to fulfill the
 *   request; the cashier should create a stock transfer.
 * - `purchase`: no location has enough stock; a purchase order is needed.
 */
export type StockSourcingSuggestion = 'available' | 'transfer' | 'purchase';

export interface StockSourcingSuggestionResponse {
  main_location: StockSourcingLocation | null;
  other_locations: StockSourcingLocation[];
  suggestion: StockSourcingSuggestion;
  requested_quantity: number;
}

/**
 * Query payload accepted by the sourcing endpoint.
 */
export interface StockSourcingSuggestionQuery {
  product_id: number;
  product_variant_id?: number | null;
  quantity: number;
}
