import {
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * Cuerpo de `POST /superadmin/subscriptions/invoices/:id/manual-payment`.
 *
 * Vivía como una clase suelta dentro del controlador y SIN UN SOLO DECORADOR
 * de class-validator. Eso no lo hacía "laxo": lo hacía **roto**, y el endpoint
 * devolvía 400 en el 100% de las llamadas.
 *
 * El `ValidationPipe` global (`apps/backend/src/main.ts`) corre con
 * `whitelist: true` + `forbidNonWhitelisted: true`. Esa pareja se comporta así:
 *
 *   1. `whitelist` construye la lista blanca a partir de las propiedades que
 *      TIENEN al menos un decorador de validación. Una clase sin decoradores
 *      tiene lista blanca vacía, así que el pipe borra `bank_reference`,
 *      `paid_at` y `amount` del body.
 *   2. `forbidNonWhitelisted` acto seguido rechaza la petición porque encontró
 *      propiedades fuera de la lista blanca... las mismas tres que acaba de
 *      quitar.
 *
 * Es decir: el pipe borra lo no decorado y luego se queja de que sobra. Nunca
 * llegó nada al handler. Sin UI que lo consumiera, el defecto no se notó hasta
 * que hizo falta registrar un pago a mano (incidente 17/08/2026).
 *
 * Regla que se sigue de acá: en este repo un DTO sin decoradores no es un DTO
 * permisivo, es un endpoint muerto. Si un campo debe pasar, se decora.
 *
 * La lista es exactamente la que consume
 * `SubscriptionManualPaymentService.recordManualPayment` (bankReference,
 * paidAt, amount); el cuarto argumento, `recordedByUserId`, sale del
 * `RequestContextService` y por eso NO viaja en el body: aceptarlo del cliente
 * permitiría falsear quién registró la conciliación.
 */
export class ManualPaymentDto {
  /**
   * Referencia del extracto bancario. Se persiste tal cual en
   * `subscription_payments.gateway_reference` (varchar) y también dentro de
   * `metadata.bank_reference`, así que se acota su longitud en el borde.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  bank_reference!: string;

  /**
   * Fecha real de acreditación del dinero, en ISO-8601. Se valida como string
   * y el controlador la convierte con `new Date(...)`: si se tipara como
   * `Date` con `enableImplicitConversion`, una cadena basura se transformaría
   * en `Invalid Date` sin fallar la validación y acabaría en `paid_at`.
   */
  @IsDateString()
  paid_at!: string;

  /**
   * Monto acreditado. Puede diferir del total de la factura: el servicio
   * calcula el excedente y lo deja como `pending_credit` (RNC-13), de modo que
   * un sobrepago no se pierde. Por eso sólo se exige positivo, no igualdad con
   * el total.
   */
  @IsNumber()
  @IsPositive()
  amount!: number;
}
