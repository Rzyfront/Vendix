import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { environment } from '../../../../../../environments/environment';

/**
 * TASA DE CAMBIO OFICIAL para el grupo `cac:PaymentExchangeRate` (FAR02-FAR07).
 *
 * ─── POR QUÉ EL FORMULARIO NO DEBE PEDIRLA A MANO ───────────────────────────
 *
 * El backend resuelve la TRM contra `datos.gov.co` (dataset `32sa-8pi3`) y la
 * cachea por día sin TTL, porque la TRM de una fecha publicada es inmutable.
 * Antes de `GET /store/invoicing/exchange-rate` ese servicio no tenía ningún
 * consumidor: el usuario tenía que ir a buscar la tasa y transcribirla, y una
 * transcripción con un dígito de más es una `cbc:CalculationRate` mal declarada
 * que la DIAN valida junto con el resto del grupo.
 *
 * ─── POR QUÉ EL VALOR SIGUE SIENDO EDITABLE ─────────────────────────────────
 *
 * La tasa PACTADA en un contrato puede diferir legítimamente de la TRM del día,
 * y quien responde por ella ante la DIAN es el emisor. El endpoint propone; el
 * formulario no impone.
 */

/** Respuesta de `GET /store/invoicing/exchange-rate`. */
export interface ExchangeRateQuote {
  currency: string;
  /** Fecha efectiva de la tasa, `YYYY-MM-DD` (`cbc:Date`, FAR07). */
  date: string;
  /**
   * Pesos por 1 unidad de `currency`, serializado como string para no perder
   * precisión en el `Decimal`. `null` en los tres casos legítimos sin tasa:
   * divisa COP, divisa ≠ USD sin cotización cruzada, y `datos.gov.co` caído.
   */
  rate: string | null;
  /** `trm` | `manual` | `manual_fallback`, o `null` si no se resolvió. */
  source: string | null;
  trm: { value: string; valid_from: string; valid_to: string } | null;
}

interface ExchangeRateResponse {
  success?: boolean;
  data?: ExchangeRateQuote;
}

@Injectable({ providedIn: 'root' })
export class ExchangeRateService {
  private readonly http = inject(HttpClient);
  private readonly url = environment.apiUrl + '/store/invoicing/exchange-rate';

  /**
   * Consulta la tasa. NUNCA lanza: un fallo devuelve `null` y el formulario
   * deja el campo editable con su aviso. Bloquear la captura de una factura
   * porque un dataset externo no respondió sería exactamente al revés.
   */
  quote(params: {
    currency: string;
    date?: string;
    usd_cross_rate?: number;
  }): Observable<ExchangeRateQuote | null> {
    let httpParams = new HttpParams().set('currency', params.currency);
    if (params.date) httpParams = httpParams.set('date', params.date);
    if (params.usd_cross_rate != null) {
      httpParams = httpParams.set(
        'usd_cross_rate',
        String(params.usd_cross_rate),
      );
    }

    return this.http
      .get<ExchangeRateResponse>(this.url, { params: httpParams })
      .pipe(
        map((response) => response?.data ?? null),
        catchError(() => of(null)),
      );
  }
}
