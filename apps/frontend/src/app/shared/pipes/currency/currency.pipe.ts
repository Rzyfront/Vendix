import {
  Injectable,
  Pipe,
  PipeTransform,
  signal,
  computed,
  inject,
} from '@angular/core';
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
  format_style?: 'comma_dot' | 'dot_comma' | 'space_comma';
  state: 'active' | 'inactive' | 'deprecated';
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

/**
 * Estado de resolución de la moneda del tenant. Es una máquina de 3 estados,
 * NO un booleano, porque "todavía no sé" y "ya intenté y no hay" exigen
 * pinturas distintas (ver `format()`):
 *
 * - `pending`    — nadie ha terminado un intento de carga todavía (o hay uno
 *                  en vuelo). NO sabemos la moneda: no se pinta cifra.
 * - `resolved`   — `currentCurrency()` trae la fila real de la tienda.
 * - `unresolved` — un intento TERMINÓ sin moneda (sin sesión, sin tienda, o el
 *                  backend falló). Aquí sí degradamos al fallback histórico:
 *                  esconder el dinero para siempre sería peor que mostrarlo con
 *                  un formato genérico.
 */
export type CurrencyResolutionState = 'pending' | 'resolved' | 'unresolved';

/**
 * Marcador que ocupa el hueco de una cifra mientras la moneda del tenant no se
 * conoce. Deliberadamente NO es `'—'`: ese guion ya significa "no aplica /
 * sin valor" en el resto de la app (`dateOnly()`, celdas vacías de tabla), y
 * confundir "no hay dato" con "todavía no sé formatearlo" es justo el tipo de
 * ambigüedad que este arreglo elimina.
 */
export const CURRENCY_PENDING_PLACEHOLDER = '…';

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
  private readonly CURRENCIES_CACHE_TTL = 30 * 60 * 1000; // 30 minutos

  // Signals para estado reactivo
  private currentCurrencySignal = signal<Currency | null>(null);
  private loadingSignal = signal<boolean>(false);
  private resolutionSignal = signal<CurrencyResolutionState>('pending');
  private lastFetchTime = 0;
  private activeCurrencies: Currency[] | null = null;
  private activeCurrenciesFetchTime = 0;
  private activeCurrenciesPromise: Promise<Currency[] | null> | null = null;

  // Signals públicos de solo lectura
  readonly currentCurrency = this.currentCurrencySignal.asReadonly();
  readonly loading = this.loadingSignal.asReadonly();
  readonly resolution = this.resolutionSignal.asReadonly();

  // Computed: moneda formateada (por si se necesita en código TS)
  readonly currencySymbol = computed(
    () => this.currentCurrency()?.symbol || '',
  );
  readonly currencyCode = computed(() => this.currentCurrency()?.code || '');
  readonly currencyPosition = computed(
    () => this.currentCurrency()?.position || 'after',
  );
  readonly currencyDecimals = computed(
    () => this.currentCurrency()?.decimal_places ?? 2,
  );
  readonly currencyFormatStyle = computed(
    () => this.currentCurrency()?.format_style || 'comma_dot',
  );

  constructor() {
    // AUTO-ARRANQUE. Hasta ahora el único que disparaba la carga era el
    // constructor del `CurrencyPipe`, así que una pantalla que consume la
    // moneda SIN el pipe —llamando a `format()` desde un helper de plantilla,
    // como `money()` en `purchase-order-detail.component.ts`— podía no pedirla
    // nunca. Con el hueco de 'pending' eso ya no es "formato feo": sería
    // quedarse sin cifras. Quien inyecta este servicio pide moneda, punto.
    //
    // En microtarea para NO escribir signals dentro del ciclo de detección de
    // cambios que construyó al primer consumidor.
    queueMicrotask(() => void this.loadCurrency());
  }

  /**
   * Carga la moneda configurada en la tienda
   * @param force - Forza recarga ignorando caché
   */
  async loadCurrency(force = false): Promise<Currency | null> {
    // Verificar caché
    if (
      !force &&
      this.currentCurrency() !== null &&
      Date.now() - this.lastFetchTime < this.CACHE_TTL
    ) {
      return this.currentCurrency();
    }

    // Ya hay un intento en vuelo. Salir SIN tocar `resolution`: seguimos en
    // 'pending' y quien arrancó el intento publicará el desenlace. Marcar
    // 'unresolved' aquí haría que el primer `| currency` de la pantalla
    // degradara al fallback justo cuando la respuesta buena venía en camino.
    if (this.loading()) {
      return null;
    }

    this.loadingSignal.set(true);

    try {
      const currency = await this.resolveCurrency(force);
      if (!currency) {
        this.markUnresolved();
      }
      return currency;
    } catch (error) {
      console.error('[CurrencyFormat] Error fetching currency:', error);
      this.markUnresolved();
      return null;
    } finally {
      this.loadingSignal.set(false);
    }
  }

  /**
   * Cascada de resolución de la moneda. Devuelve `null` cuando el intento
   * terminó sin moneda; el estado `resolution` lo publica `loadCurrency()`,
   * que es el único dueño del ciclo de vida del intento.
   */
  private async resolveCurrency(force: boolean): Promise<Currency | null> {
    // 1. Try to get currency from domain config (injected at boot, no HTTP needed)
    const domainCurrency =
      this.tenantFacade.getCurrentDomainConfig()?.customConfig?.currency;
    if (domainCurrency) {
      this.setCurrency(domainCurrency);
      return domainCurrency;
    }

    // 2. Fallback: fetch via HTTP (for store-admin context where domain config may lack currency)
    // Only attempt /store/settings if the user is authenticated AND has a store context
    if (!this.hasValidAuthState()) {
      return null;
    }

    const cachedCurrencyCode = this.getCurrencyCodeFromAuthState();
    if (cachedCurrencyCode) {
      return this.loadCurrencyForCode(cachedCurrencyCode, force);
    }

    const storeId = this.tenantFacade.getCurrentStoreId();
    if (!storeId) {
      return null;
    }

    const settingsResponse = await firstValueFrom(
      this.http.get<ApiResponse<StoreSettings>>(
        `${environment.apiUrl}/store/settings`,
      ),
    );

    if (
      !settingsResponse.success ||
      !settingsResponse.data?.general?.currency
    ) {
      return null;
    }

    return this.loadCurrencyForCode(
      settingsResponse.data.general.currency,
      force,
    );
  }

  /**
   * Publica la moneda resuelta. Único punto que escribe
   * `currentCurrencySignal`: escribirlo en varios sitios fue lo que dejó
   * `resolution` desincronizado del valor.
   */
  private setCurrency(currency: Currency): void {
    this.currentCurrencySignal.set(currency);
    this.lastFetchTime = Date.now();
    this.resolutionSignal.set('resolved');
  }

  /**
   * Un intento TERMINÓ sin moneda. Degrada a 'unresolved' para que `format()`
   * deje de esconder cifras y vuelva al fallback histórico. No pisa un
   * 'resolved' previo: una recarga fallida no debe borrar la moneda que ya
   * teníamos buena.
   */
  private markUnresolved(): void {
    if (this.currentCurrencySignal() === null) {
      this.resolutionSignal.set('unresolved');
    }
  }

  async loadCurrencyForCode(
    currencyCode: string,
    force = false,
  ): Promise<Currency | null> {
    if (!currencyCode) {
      return null;
    }

    const current = this.currentCurrency();
    if (
      !force &&
      current?.code === currencyCode &&
      Date.now() - this.lastFetchTime < this.CACHE_TTL
    ) {
      return current;
    }

    const currencies = await this.loadActiveCurrencies(force);
    if (!currencies) {
      return null;
    }

    const currency = currencies.find((c: Currency) => c.code === currencyCode);
    if (!currency) {
      return null;
    }

    this.setCurrency(currency);

    return currency;
  }

  private async loadActiveCurrencies(
    force = false,
  ): Promise<Currency[] | null> {
    if (
      !force &&
      this.activeCurrencies &&
      Date.now() - this.activeCurrenciesFetchTime < this.CURRENCIES_CACHE_TTL
    ) {
      return this.activeCurrencies;
    }

    if (this.activeCurrenciesPromise) {
      return this.activeCurrenciesPromise;
    }

    this.activeCurrenciesPromise = firstValueFrom(
      this.http.get<{ success: boolean; data: Currency[]; message?: string }>(
        `${environment.apiUrl}/public/currencies/active`,
      ),
    )
      .then((currencyResponse) => {
        if (!currencyResponse.success || !currencyResponse.data) {
          return null;
        }

        this.activeCurrencies = currencyResponse.data;
        this.activeCurrenciesFetchTime = Date.now();
        return this.activeCurrencies;
      })
      .catch((error) => {
        console.error(
          '[CurrencyFormat] Error fetching active currencies:',
          error,
        );
        return this.activeCurrencies;
      })
      .finally(() => {
        this.activeCurrenciesPromise = null;
      });

    return this.activeCurrenciesPromise;
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

  private getCurrencyCodeFromAuthState(): string | null {
    try {
      if (typeof localStorage === 'undefined') return null;
      const authState = localStorage.getItem('vendix_auth_state');
      if (!authState) return null;
      const parsed = JSON.parse(authState);
      return parsed?.store_settings?.general?.currency ?? null;
    } catch {
      return null;
    }
  }

  private getLocaleForStyle(style?: string): string {
    switch (style) {
      case 'dot_comma':
        return 'de-DE';
      case 'space_comma':
        return 'fr-FR';
      case 'comma_dot':
      default:
        return 'en-US';
    }
  }

  /**
   * Formatea un monto con la moneda actual.
   *
   * ── Por qué la primera pintura NO muestra cifra ────────────────────────────
   * Entrando en frío por enlace profundo (p. ej. `/admin/orders/
   * purchase-orders/215` en pestaña nueva), la moneda viaja por HTTP y llega
   * DESPUÉS del primer render. Había dos salidas posibles:
   *
   *   (a) no pintar cifra hasta que la moneda resuelva, o
   *   (b) pintar con un formato por defecto.
   *
   * Se eligió (a). Razón: en (b) NO existe un defecto correcto. La moneda es
   * por tienda (`stores.settings.general.currency`) y el estilo y los decimales
   * viven en la fila de `currencies` (`format_style`, `decimal_places`), así que
   * cualquier defecto miente a la mitad de los tenants — y miente de la peor
   * manera: `$100,436.18` es una cifra PLAUSIBLE, y un operador colombiano la
   * lee como cien pesos con céntimos cuando en realidad son `$100.436`. El
   * lector no tiene forma de saber que era provisional. Un hueco, en cambio, se
   * ve como lo que es: "todavía no". El plan al que pertenece este arreglo
   * existe justamente para que el operador nunca lea una cifra distinta de la
   * que es, y una cifra provisional creíble viola eso; un hueco de ~300 ms, no.
   *
   * El hueco solo dura mientras `resolution() === 'pending'`. Cuando un intento
   * termina sin moneda (`'unresolved'`: sin sesión, sin tienda, backend caído)
   * se degrada al fallback histórico en-US: esconder el dinero PARA SIEMPRE
   * sería peor que mostrarlo con un formato genérico.
   *
   * ── Por qué repinta cuando llega la moneda ─────────────────────────────────
   * `currentCurrency()` y `resolution()` se leen DENTRO de este método, que las
   * plantillas invocan (vía `CurrencyPipe` impuro o vía helpers de componente
   * tipo `money()`), y Angular ejecuta la plantilla dentro del consumidor
   * reactivo de la vista. Esas lecturas quedan registradas como dependencias de
   * la vista, así que al resolver la moneda la vista se marca sucia y se
   * repinta sola. Es CD por Signals, no `markForCheck()`.
   */
  format(
    amount: number | string | null | undefined,
    decimals?: number,
  ): string {
    const num = Number(amount) || 0;
    const currency = this.currentCurrency();
    if (!currency) {
      if (this.resolution() === 'pending') {
        return CURRENCY_PENDING_PLACEHOLDER;
      }
      // Fallback con símbolo por defecto: la resolución terminó sin moneda
      const dec = decimals ?? 2;
      const formatted = num.toLocaleString('en-US', {
        minimumFractionDigits: dec,
        maximumFractionDigits: dec,
      });
      return `$${formatted}`;
    }

    const dec = decimals ?? currency.decimal_places ?? 2;
    const locale = this.getLocaleForStyle(currency.format_style);
    const formatted = num.toLocaleString(locale, {
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
  formatCompact(amount: number | string | null | undefined): string {
    const num = Number(amount) || 0;
    const currency = this.currentCurrency();
    const symbol = currency?.symbol || '$';
    const position = currency?.position || 'before';

    let formatted: string;
    if (Math.abs(num) >= 1_000_000) {
      formatted = `${(num / 1_000_000).toFixed(1)}M`;
    } else if (Math.abs(num) >= 1_000) {
      formatted = `${(num / 1_000).toFixed(1)}K`;
    } else {
      formatted = Math.round(num).toLocaleString(
        this.getLocaleForStyle(currency?.format_style),
      );
    }

    return position === 'before'
      ? `${symbol}${formatted}`
      : `${formatted}${symbol}`;
  }

  /**
   * Formato compacto para ejes de gráficos: K enteros, sin decimales.
   */
  formatChartAxis(value: number | string | null | undefined): string {
    const num = Number(value) || 0;
    const currency = this.currentCurrency();
    const symbol = currency?.symbol || '$';
    const position = currency?.position || 'before';

    let formatted: string;
    if (Math.abs(num) >= 1_000_000) {
      formatted = `${Math.round(num / 1_000_000)}M`;
    } else if (Math.abs(num) >= 1_000) {
      formatted = `${Math.round(num / 1_000)}K`;
    } else {
      formatted = `${Math.round(num)}`;
    }

    return position === 'before'
      ? `${symbol}${formatted}`
      : `${formatted}${symbol}`;
  }

  /**
   * Limpia la caché y recarga la moneda
   */
  async refresh(): Promise<void> {
    this.currentCurrencySignal.set(null);
    this.resolutionSignal.set('pending');
    this.lastFetchTime = 0;
    await this.loadCurrency(true);
  }

  /**
   * Limpia la caché (sin recargar).
   *
   * Vuelve a 'pending' a propósito: olvidar la moneda y seguir declarándola
   * resuelta dejaría a `format()` pintando el fallback en-US como si fuera la
   * verdad. Quien llame a esto debe recargar (`loadCurrency`) o la app se queda
   * sin cifras.
   */
  clearCache(): void {
    this.currentCurrencySignal.set(null);
    this.resolutionSignal.set('pending');
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
 *
 * SIGUE SIENDO IMPURO, a propósito. Sus argumentos (`value`, `forceDecimals`)
 * no cambian cuando llega la moneda, así que un pipe puro quedaría memoizado
 * con el resultado del primer render y jamás repintaría. La reactividad no la
 * da la impureza por sí sola: la da la lectura de `currentCurrency()` /
 * `resolution()` dentro de `CurrencyFormatService.format()`, que Angular
 * registra en el consumidor reactivo de la vista y por tanto marca la vista
 * sucia cuando la moneda resuelve. La impureza solo garantiza que, una vez la
 * vista se re-chequea, el `transform` vuelva a correr.
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

  transform(value: number | null | undefined, forceDecimals?: number): string {
    // Manejar valores nulos
    if (value === null || value === undefined) {
      return '';
    }

    // Usar el servicio para formatear
    return this.currencyService.format(value, forceDecimals);
  }
}
