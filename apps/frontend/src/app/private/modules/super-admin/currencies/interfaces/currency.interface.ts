export enum CurrencyState {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  DEPRECATED = 'deprecated',
}

export interface Currency {
  code: string;
  name: string;
  symbol: string;
  decimal_places: number;
  state: CurrencyState;
}

export interface CreateCurrencyDto {
  code: string;
  name: string;
  symbol: string;
  decimal_places: number;
  state?: CurrencyState;
}

export interface UpdateCurrencyDto {
  name?: string;
  symbol?: string;
  decimal_places?: number;
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
