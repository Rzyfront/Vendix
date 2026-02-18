import { Injectable, Pipe, PipeTransform, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { TenantFacade } from '../../../core/store/tenant/tenant.facade';

// ============================================================================
// INTERFACES
// ============================================================================

export interface StoreSettings {
  general: {
    currency: string;
    timezone: string;
    language: string;
    tax_included: boolean;
  };
}

export interface Currency {
  code: string;
  name: string;
  symbol: string;
  decimal_places: number;
  position: 'before' | 'after';
  state: 'active' | 'inactive' | 'deprecated';
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

// ============================================================================
// CURRENCY SERVICE - Servicio global con Signals
// ============================================================================

/**
 * Servicio centralizado para manejar la moneda de la tienda.
 * Usa Signals para que los componentes y pipes se actualicen automáticamente.
 */
@Injectable({
  providedIn: 'root',
})
export class CurrencyFormatService {
  private readonly http = inject(HttpClient);
  private readonly tenantFacade = inject(TenantFacade);
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutos

  // Signals para estado reactivo
  private currentCurrencySignal = signal<Currency | null>(null);
  private loadingSignal = signal<boolean>(false);
  private lastFetchTime = 0;

  // Signals públicos de solo lectura
  readonly currentCurrency = this.currentCurrencySignal.asReadonly();
  readonly loading = this.loadingSignal.asReadonly();

  // Computed: moneda formateada (por si se necesita en código TS)
  readonly currencySymbol = computed(() => this.currentCurrency()?.symbol || '');
  readonly currencyCode = computed(() => this.currentCurrency()?.code || '');
  readonly currencyPosition = computed(() => this.currentCurrency()?.position || 'after');
  readonly currencyDecimals = computed(() => this.currentCurrency()?.decimal_places ?? 2);

  /**
   * Carga la moneda configurada en la tienda
   * @param force - Forza recarga ignorando caché
   */
  async loadCurrency(force = false): Promise<Currency | null> {
    console.log('[CurrencyFormat] loadCurrency called, force:', force, 'current:', this.currentCurrency()?.code);

    // Verificar caché
    if (!force && this.currentCurrency() !== null && Date.now() - this.lastFetchTime < this.CACHE_TTL) {
      console.log('[CurrencyFormat] Using cached currency');
      return this.currentCurrency();
    }

    if (this.loading()) {
      console.log('[CurrencyFormat] Already loading, skipping');
      return null;
    }

    this.loadingSignal.set(true);

    try {
      // 1. Try to get currency from domain config (injected at boot, no HTTP needed)
      const domainCurrency = this.tenantFacade.getCurrentDomainConfig()?.customConfig?.currency;
      if (domainCurrency) {
        console.log('[CurrencyFormat] Using currency from domain config:', domainCurrency.code);
        this.currentCurrencySignal.set(domainCurrency);
        this.lastFetchTime = Date.now();
        return domainCurrency;
      }

      // 2. Fallback: fetch via HTTP (for store-admin context where domain config may lack currency)
      // Only attempt /store/settings if the user is authenticated
      if (!this.hasValidAuthState()) {
        console.warn('[CurrencyFormat] No domain currency and no auth state, skipping HTTP fetch');
        return null;
      }

      console.log('[CurrencyFormat] Fetching store settings (admin fallback)...');
      const settingsResponse = await firstValueFrom(
        this.http.get<ApiResponse<StoreSettings>>(`${environment.apiUrl}/store/settings`)
      );

      if (!settingsResponse.success || !settingsResponse.data?.general?.currency) {
        console.warn('[CurrencyFormat] No currency in settings');
        return null;
      }

      const currencyCode = settingsResponse.data.general.currency;

      const currencyResponse = await firstValueFrom(
        this.http.get<{ success: boolean; data: Currency[]; message?: string }>(
          `${environment.apiUrl}/public/currencies/active`
        )
      );

      if (!currencyResponse.success || !currencyResponse.data) {
        console.warn('[CurrencyFormat] No active currencies found');
        return null;
      }

      const currency = currencyResponse.data.find((c: Currency) => c.code === currencyCode);

      if (!currency) {
        console.warn(`[CurrencyFormat] Currency ${currencyCode} not found in active currencies`);
        return null;
      }

      console.log('[CurrencyFormat] Found currency via HTTP:', currency.code);
      this.currentCurrencySignal.set(currency);
      this.lastFetchTime = Date.now();

      return currency;
    } catch (error) {
      console.error('[CurrencyFormat] Error fetching currency:', error);
      return null;
    } finally {
      this.loadingSignal.set(false);
    }
  }

  /**
   * Check if user has valid auth state in localStorage
   */
  private hasValidAuthState(): boolean {
    try {
      if (typeof localStorage === 'undefined') return false;
      const authState = localStorage.getItem('vendix_auth_state');
      if (!authState) return false;
      const parsed = JSON.parse(authState);
      return !!(parsed?.user && parsed?.tokens?.access_token);
    } catch {
      return false;
    }
  }

  /**
   * Formatea un monto con la moneda actual
   */
  format(amount: number, decimals?: number): string {
    const currency = this.currentCurrency();
    if (!currency) {
      // Fallback con símbolo por defecto mientras carga la moneda
      const dec = decimals ?? 2;
      const formatted = amount.toLocaleString('en-US', {
        minimumFractionDigits: dec,
        maximumFractionDigits: dec,
      });
      // Usar $ como fallback mientras carga
      return `$${formatted}`;
    }

    const dec = decimals ?? currency.decimal_places ?? 2;
    const formatted = amount.toLocaleString('en-US', {
      minimumFractionDigits: dec,
      maximumFractionDigits: dec,
    });

    const symbol = currency.symbol || currency.code;
    if (currency.position === 'before') {
      return `${symbol}${formatted}`;
    } else {
      return `${formatted}${symbol}`;
    }
  }

  /**
   * Formatea un monto con sufijos compactos (K/M) respetando la posición de la moneda.
   * Ideal para stats cards, tooltips y celdas de tabla.
   */
  formatCompact(amount: number): string {
    const currency = this.currentCurrency();
    const symbol = currency?.symbol || '$';
    const position = currency?.position || 'before';

    let formatted: string;
    if (Math.abs(amount) >= 1_000_000) {
      formatted = `${(amount / 1_000_000).toFixed(1)}M`;
    } else if (Math.abs(amount) >= 1_000) {
      formatted = `${(amount / 1_000).toFixed(1)}K`;
    } else {
      formatted = Math.round(amount).toLocaleString('en-US');
    }

    return position === 'before' ? `${symbol}${formatted}` : `${formatted}${symbol}`;
  }

  /**
   * Formato compacto para ejes de gráficos: K enteros, sin decimales.
   */
  formatChartAxis(value: number): string {
    const currency = this.currentCurrency();
    const symbol = currency?.symbol || '$';
    const position = currency?.position || 'before';

    let formatted: string;
    if (Math.abs(value) >= 1_000_000) {
      formatted = `${Math.round(value / 1_000_000)}M`;
    } else if (Math.abs(value) >= 1_000) {
      formatted = `${Math.round(value / 1_000)}K`;
    } else {
      formatted = `${Math.round(value)}`;
    }

    return position === 'before' ? `${symbol}${formatted}` : `${formatted}${symbol}`;
  }

  /**
   * Limpia la caché y recarga la moneda
   */
  async refresh(): Promise<void> {
    this.currentCurrencySignal.set(null);
    this.lastFetchTime = 0;
    await this.loadCurrency(true);
  }

  /**
   * Limpia la caché (sin recargar)
   */
  clearCache(): void {
    this.currentCurrencySignal.set(null);
    this.lastFetchTime = 0;
  }
}

// ============================================================================
// CURRENCY PIPE
// ============================================================================

/**
 * Pipe para formatear montos con la moneda configurada en la tienda.
 * Reacciona automáticamente a cambios en la configuración.
 *
 * @example
 * {{ 1234.56 | currency }}           // Usa moneda de la tienda
 * {{ 1234.56 | currency: 2 }}         // Forza 2 decimales
 */
@Pipe({
  name: 'currency',
  standalone: true,
  pure: false, // Impuro para reaccionar a cambios
})
export class CurrencyPipe implements PipeTransform {
  private currencyService = inject(CurrencyFormatService);

  constructor() {
    // Asegurar que la moneda esté cargada
    this.currencyService.loadCurrency();
  }

  transform(
    value: number | null | undefined,
    forceDecimals?: number
  ): string {
    // Manejar valores nulos
    if (value === null || value === undefined) {
      return '';
    }

    // Usar el servicio para formatear
    return this.currencyService.format(value, forceDecimals);
  }
}
