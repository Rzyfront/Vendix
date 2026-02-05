import { Injectable, Pipe, PipeTransform, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';

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
      // 1. Obtener settings de la tienda
      console.log('[CurrencyFormat] Fetching store settings...');
      const settingsResponse = await firstValueFrom(
        this.http.get<ApiResponse<StoreSettings>>(`${environment.apiUrl}/store/settings`)
      );

      console.log('[CurrencyFormat] Settings response:', settingsResponse);

      if (!settingsResponse.success || !settingsResponse.data?.general?.currency) {
        console.warn('[CurrencyFormat] No currency in settings');
        return null;
      }

      const currencyCode = settingsResponse.data.general.currency;
      console.log('[CurrencyFormat] Currency code from settings:', currencyCode);

      // 2. Obtener detalles de la moneda activa
      console.log('[CurrencyFormat] Fetching active currencies...');
      const currencyResponse = await firstValueFrom(
        this.http.get<{ success: boolean; data: Currency[]; message?: string }>(
          `${environment.apiUrl}/public/currencies/active`
        )
      );

      console.log('[CurrencyFormat] Active currencies response:', currencyResponse);

      if (!currencyResponse.success || !currencyResponse.data) {
        console.warn('[CurrencyFormat] No active currencies found');
        return null;
      }

      const currency = currencyResponse.data.find((c: Currency) => c.code === currencyCode);

      if (!currency) {
        console.warn(`[CurrencyFormat] Currency ${currencyCode} not found in active currencies`);
        console.log('[CurrencyFormat] Available currencies:', currencyResponse.data?.map(c => c.code));
        return null;
      }

      console.log('[CurrencyFormat] Found currency:', currency);

      // Actualizar signal
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
