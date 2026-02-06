export enum CurrencyState {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  DEPRECATED = 'deprecated',
}

export enum CurrencyPosition {
  BEFORE = 'before',
  AFTER = 'after',
}

export interface Currency {
  code: string;
  name: string;
  symbol: string;
  decimal_places: number;
  position: CurrencyPosition;  // NUEVO CAMPO
  state: CurrencyState;
}

// DTO para activar una moneda desde AppNexus
export interface ActivateCurrencyDto {
  code: string;           // From AppNexus (readonly)
  name: string;           // From AppNexus (readonly)
  symbol: string;         // From AppNexus (readonly)
  position: CurrencyPosition; // From AppNexus (valor por defecto, configurable)
  decimal_places: number; // Configurable
  state?: CurrencyState;
}

// DTO actualizado - solo campos configurables
export interface CreateCurrencyDto {
  code: string;
  name: string;
  symbol: string;
  decimal_places: number;
  position?: CurrencyPosition;  // Opcional, valor por defecto desde API
  state?: CurrencyState;
}

// DTO actualizado - solo campos configurables (code, name, symbol no editables)
export interface UpdateCurrencyDto {
  decimal_places?: number;  // Solo campos configurables
  position?: CurrencyPosition;  // Configurable (sobrescribe valor de API)
  state?: CurrencyState;
}

export interface CurrencyQueryDto {
  page?: number;
  limit?: number;
  search?: string;
  state?: CurrencyState;
}

export interface CurrencyStats {
  total_currencies: number;
  active_currencies: number;
  inactive_currencies: number;
  deprecated_currencies: number;
}

export interface PaginatedCurrenciesResponse {
  data: Currency[];
  meta: {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
  };
}
