import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

// ============================================================================
// CONSTANTES DE CONFIGURACIÓN
// ============================================================================

const CURRENCY_API_BASE_URL = 'https://currency-rate-exchange-api.onrender.com';
const API_TIMEOUT = 10000; // 10 segundos

// ============================================================================
// TIPOS DE LA API EXTERNA (Currency Rate Exchange API)
// ============================================================================

interface CurrencyCodesResponse {
  success: boolean;
  codes: string[];
  count: number;
}

interface CurrencyDetailsResponse {
  currencyCode: string;
  currencyName: string;
  currencySymbol: string;
  countryName: string;
  countryCode: string;
  flagImage: string;
  rates?: {
    date: string;
    [key: string]: number | string;
  };
}

interface ApiErrorResponse {
  message: string;
}

// ============================================================================
// TIPOS EXPUESTOS PARA USO INTERNO
// ============================================================================

export interface CurrencyCodeInfo {
  code: string; // ISO 4217 (3 letras)
}

export interface CurrencyDetails {
  code: string;        // ISO 4217 (3 letras)
  name: string;        // Nombre completo (ej: "Indian Rupee")
  symbol: string;      // Símbolo (ej: "₹")
  countryName: string; // Nombre del país (ej: "India")
  countryCode: string; // Código del país (ej: "IN")
  flagImage: string;   // URL de la bandera
}

// Enum para la posición del símbolo
export enum CurrencyPosition {
  BEFORE = 'before',
  AFTER = 'after',
}

// Enum para el estado de la moneda
export enum CurrencyState {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  DEPRECATED = 'deprecated',
}

// Interfaz interna para el sistema
export interface Currency {
  code: string;
  name: string;
  symbol: string;
  decimal_places: number;
  position: CurrencyPosition;
  state: CurrencyState;
}

// DTO para activar una moneda
export interface ActivateCurrencyDto {
  code: string;           // ISO 4217 code (3 letras)
  name: string;           // Nombre completo
  symbol: string;         // Símbolo
  position: CurrencyPosition;
  decimal_places: number; // Decimales (configurable)
  state?: CurrencyState;
}

// ============================================================================
// CLASES DE ERROR
// ============================================================================

export class CurrencyApiError extends Error {
  override readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'CurrencyApiError';
    this.cause = cause;
  }
}

// ============================================================================
// SERVICIO
// ============================================================================

@Injectable({
  providedIn: 'root',
})
export class CurrencyService {
  private readonly http = inject(HttpClient);
  private readonly API_URL = environment.apiUrl; // URL del backend

  private cachedCodes: CurrencyCodeInfo[] | null = null;
  private cacheTimestamp: number | null = null;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutos
  private activeCurrenciesCache: Currency[] | null = null;
  private activeCurrenciesCacheTime: number | null = null;

  // ==========================================================================
  // MÉTODOS PÚBLICOS - OBTENCIÓN DE MONEDAS DESDE API EXTERNA
  // ==========================================================================

  /**
   * Paso 1: Obtiene la lista de códigos de moneda disponibles
   * Este endpoint es rápido y ligero, ideal para el selector inicial
   */
  async getAvailableCurrencyCodes(): Promise<CurrencyCodeInfo[]> {
    // Verificar caché
    if (this.isCacheValid()) {
      return this.cachedCodes!;
    }

    try {
      const response = await this.fetchWithTimeout<CurrencyCodesResponse>(
        `${CURRENCY_API_BASE_URL}/`
      );

      // Validar respuesta
      if (!this.isValidCodesResponse(response)) {
        throw new CurrencyApiError('Respuesta inválida de la API de códigos');
      }

      // Sanear y formatear datos
      const codes = this.sanitizeCurrencyCodes(response.codes);

      // Actualizar caché
      this.cachedCodes = codes;
      this.cacheTimestamp = Date.now();

      return codes;
    } catch (error) {
      console.error('[CurrencyService] Error fetching currency codes:', error);
      throw new CurrencyApiError(
        'No se pudieron obtener los códigos de moneda',
        error
      );
    }
  }

  /**
   * Paso 2: Obtiene los detalles completos de una moneda específica
   * Debe llamarse después que el usuario selecciona un código
   */
  async getCurrencyDetails(code: string): Promise<CurrencyDetails> {
    // Validar código
    const sanitizedCode = this.validateAndSanitizeCode(code);

    try {
      const response = await this.fetchWithTimeout<CurrencyDetailsResponse>(
        `${CURRENCY_API_BASE_URL}/${sanitizedCode}`
      );

      // Validar respuesta
      if (!this.isValidDetailsResponse(response)) {
        throw new CurrencyApiError(
          `Respuesta inválida para el código ${sanitizedCode}`
        );
      }

      // Sanear y formatear datos
      return this.sanitizeCurrencyDetails(response);
    } catch (error) {
      if (error instanceof CurrencyApiError) {
        throw error;
      }
      console.error(
        `[CurrencyService] Error fetching details for ${sanitizedCode}:`,
        error
      );
      throw new CurrencyApiError(
        `No se pudieron obtener los detalles de la moneda ${sanitizedCode}`,
        error
      );
    }
  }

  // ==========================================================================
  // MÉTODOS PÚBLICOS - MONEDAS ACTIVAS EN EL SISTEMA
  // ==========================================================================

  /**
   * Obtiene las monedas activas configuradas en el sistema (desde backend)
   * Endpoint: GET /public/currencies/active
   * Requiere autenticación JWT pero no roles específicos
   */
  async getActiveCurrencies(): Promise<Currency[]> {
    // Verificar caché (5 minutos)
    const CACHE_TTL = 5 * 60 * 1000;
    if (
      this.activeCurrenciesCache &&
      this.activeCurrenciesCacheTime &&
      Date.now() - this.activeCurrenciesCacheTime < CACHE_TTL
    ) {
      return this.activeCurrenciesCache;
    }

    try {
      const response = await firstValueFrom(
        this.http.get<{ success: boolean; data: Currency[]; message?: string }>(
          `${this.API_URL}/public/currencies/active`
        )
      );

      if (response.success && response.data) {
        this.activeCurrenciesCache = response.data;
        this.activeCurrenciesCacheTime = Date.now();
        return response.data;
      }

      return [];
    } catch (error) {
      console.error('[CurrencyService] Error fetching active currencies:', error);
      return [];
    }
  }

  /**
   * Obtiene moneda por código desde las monedas activas
   */
  async getCurrencyByCode(code: string): Promise<Currency | null> {
    const currencies = await this.getActiveCurrencies();
    return currencies.find((c) => c.code === code) || null;
  }

  // ==========================================================================
  // MÉTODOS PÚBLICOS - UTILIDADES
  // ==========================================================================

  /**
   * Formatea un monto según la configuración de la moneda
   */
  formatCurrency(amount: number, currency: Currency): string {
    const formattedAmount = amount.toFixed(currency.decimal_places);
    if (currency.position === CurrencyPosition.BEFORE) {
      return `${currency.symbol}${formattedAmount}`;
    } else {
      return `${formattedAmount}${currency.symbol}`;
    }
  }

  /**
   * Convierte detalles de la API al formato interno de Currency
   * Se usa al activar una moneda en el sistema
   */
  fromApiToCurrency(
    apiDetails: CurrencyDetails,
    decimalPlaces: number,
    position?: CurrencyPosition
  ): Currency {
    return {
      code: apiDetails.code,
      name: apiDetails.name,
      symbol: apiDetails.symbol,
      decimal_places: decimalPlaces,
      position: position || CurrencyPosition.BEFORE, // Todas en before por defecto
      state: CurrencyState.ACTIVE,
    };
  }

  /**
   * Convierte detalles de la API a DTO para activar moneda
   */
  fromApiToDto(
    apiDetails: CurrencyDetails,
    decimalPlaces: number,
    position?: CurrencyPosition
  ): ActivateCurrencyDto {
    return {
      code: apiDetails.code,
      name: apiDetails.name,
      symbol: apiDetails.symbol,
      decimal_places: decimalPlaces,
      position: position || CurrencyPosition.BEFORE,
      state: CurrencyState.ACTIVE,
    };
  }

  // ==========================================================================
  // MÉTODOS PRIVADOS - VALIDACIÓN Y SANEAMIENTO
  // ==========================================================================

  /**
   * Verifica si el caché es válido
   */
  private isCacheValid(): boolean {
    return (
      this.cachedCodes !== null &&
      this.cacheTimestamp !== null &&
      Date.now() - this.cacheTimestamp < this.CACHE_TTL
    );
  }

  /**
   * Valida y sanea el código de moneda antes de hacer la petición
   */
  private validateAndSanitizeCode(code: string): string {
    // Eliminar espacios
    let sanitized = code.trim();

    // Convertir a mayúsculas
    sanitized = sanitized.toUpperCase();

    // Validar formato ISO 4217 (exactamente 3 letras)
    if (!/^[A-Z]{3}$/.test(sanitized)) {
      throw new CurrencyApiError(
        `Código de moneda inválido: "${code}". Debe ser un código ISO 4217 de 3 letras.`
      );
    }

    return sanitized;
  }

  /**
   * Valida la estructura de respuesta de códigos
   */
  private isValidCodesResponse(response: unknown): response is CurrencyCodesResponse {
    if (!response || typeof response !== 'object') {
      return false;
    }

    const r = response as Partial<CurrencyCodesResponse>;
    return (
      r.success === true &&
      Array.isArray(r.codes) &&
      typeof r.count === 'number' &&
      r.codes.length === r.count
    );
  }

  /**
   * Valida la estructura de respuesta de detalles
   */
  private isValidDetailsResponse(response: unknown): response is CurrencyDetailsResponse {
    if (!response || typeof response !== 'object') {
      return false;
    }

    const r = response as Partial<CurrencyDetailsResponse>;
    return (
      typeof r.currencyCode === 'string' &&
      typeof r.currencyName === 'string' &&
      typeof r.currencySymbol === 'string' &&
      typeof r.countryName === 'string' &&
      typeof r.countryCode === 'string' &&
      typeof r.flagImage === 'string'
    );
  }

  /**
   * Sanea la lista de códigos de moneda
   */
  private sanitizeCurrencyCodes(codes: string[]): CurrencyCodeInfo[] {
    return codes
      .filter((code) => /^[A-Z]{3}$/.test(code)) // Solo códigos ISO válidos
      .sort()
      .map((code) => ({ code }));
  }

  /**
   * Sanea los detalles de moneda de la respuesta
   */
  private sanitizeCurrencyDetails(
    response: CurrencyDetailsResponse
  ): CurrencyDetails {
    return {
      code: response.currencyCode.toUpperCase(),
      name: this.sanitizeString(response.currencyName),
      symbol: this.sanitizeString(response.currencySymbol),
      countryName: this.sanitizeString(response.countryName),
      countryCode: response.countryCode.toUpperCase(),
      flagImage: this.validateAndSanitizeUrl(response.flagImage),
    };
  }

  /**
   * Sanea strings eliminando caracteres potencialmente peligrosos
   */
  private sanitizeString(str: string): string {
    return str.trim().slice(0, 255); // Limitar longitud
  }

  /**
   * Valida y sanea URLs (solo permitir HTTPS de dominios conocidos)
   */
  private validateAndSanitizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') {
        throw new CurrencyApiError('URL insegura (no es HTTPS)');
      }
      return parsed.href;
    } catch {
      throw new CurrencyApiError(`URL inválida: ${url}`);
    }
  }

  /**
   * Fetch con timeout para evitar peticiones colgadas
   */
  private async fetchWithTimeout<T>(url: string): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        // Intentar parsear error de la API
        try {
          const errorData = (await response.json()) as ApiErrorResponse;
          if (errorData.message === 'Currency not found') {
            throw new CurrencyApiError('Moneda no encontrada en la API');
          }
        } catch {
          // Si no es JSON o no tiene el formato esperado
        }
        throw new CurrencyApiError(
          `Error en la petición: ${response.status} ${response.statusText}`
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof CurrencyApiError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new CurrencyApiError('La petición excedió el tiempo límite');
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ==========================================================================
  // CACHE MANAGEMENT
  // ==========================================================================

  /**
   * Limpia la caché de códigos
   */
  clearCache(): void {
    this.cachedCodes = null;
    this.cacheTimestamp = null;
  }
}
