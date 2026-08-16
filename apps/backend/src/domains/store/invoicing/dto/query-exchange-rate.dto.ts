import { Transform } from 'class-transformer';
import {
  IsISO4217CurrencyCode,
  IsOptional,
  IsPositive,
  IsNumber,
  Matches,
} from 'class-validator';

/**
 * Consulta de la tasa de cambio a declarar en `cac:PaymentExchangeRate`.
 *
 * ─── POR QUÉ ES UN ENDPOINT Y NO UN CAMPO QUE EL USUARIO TECLEA ─────────────
 *
 * `TrmService` ya resuelve la TRM oficial contra `datos.gov.co` y la cachea sin
 * TTL (la TRM de un día publicado es inmutable), pero NINGÚN controlador lo
 * exponía: el formulario de factura pedía la tasa a mano, así que el
 * comerciante tenía que ir a buscarla y transcribirla. Una tasa transcrita mal
 * es una `cbc:CalculationRate` mal declarada, y la DIAN valida el grupo entero
 * (FAR02-FAR07).
 *
 * El endpoint NO decide por el usuario: devuelve la tasa oficial y la `source`
 * con la que se resolvió, y el formulario la ofrece como valor por defecto
 * editable. La tasa pactada en un contrato puede diferir legítimamente de la
 * TRM del día, y quien responde por ella ante la DIAN es el emisor.
 */
export class QueryExchangeRateDto {
  /**
   * Divisa de la operación (ISO 4217). `COP` es una consulta válida y responde
   * `null`: no hay conversión que declarar, y la DIAN RECHAZA un
   * `cbc:SourceCurrencyBaseRate` igual a 1,00 (FAR03).
   */
  @IsISO4217CurrencyCode()
  @Transform(({ value }) => String(value ?? '').trim().toUpperCase())
  currency: string;

  /**
   * Fecha de la tasa (`cbc:Date`, FAR07). Opcional: el servicio usa la fecha de
   * emisión del documento, y quien consulta desde el formulario todavía puede
   * estar cambiándola.
   */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date debe tener el formato YYYY-MM-DD',
  })
  date?: string;

  /**
   * Cuántas unidades de `currency` vale 1 USD ese día. Sólo se usa —y sólo hace
   * falta— cuando la divisa no es USD: la conversión es entonces `TRM /
   * usd_cross_rate`.
   *
   * No se resuelve automáticamente a propósito (ver el docblock de
   * `TrmService.resolveExchangeRate`): la TRM es el único tipo de cambio con
   * fuente oficial colombiana, y elegir un proveedor de FX privado para el
   * resto es una decisión del contribuyente, no del software.
   */
  @IsOptional()
  @Transform(({ value }) => (value == null || value === '' ? undefined : Number(value)))
  @IsNumber()
  @IsPositive()
  usd_cross_rate?: number;
}
