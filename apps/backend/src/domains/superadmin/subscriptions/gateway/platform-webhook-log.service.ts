import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';

/**
 * Cómo terminó el turno del webhook. `processed` es el único que implica que
 * el negocio corrió; los tres `acked_*` describen ACKs que NO tocaron el
 * estado de la suscripción — y son justamente los que antes se iban sin dejar
 * rastro.
 */
export type PlatformWebhookOutcome =
  | 'processed'
  | 'acked_invalid'
  | 'acked_error'
  | 'acked_disabled';

export interface RecordWebhookInput {
  processor: string;
  body: any;
  outcome: PlatformWebhookOutcome;
  /** null cuando el camino ni siquiera llegó a validar (flag apagado). */
  signatureValid?: boolean | null;
  /** `reason` del validador: bad_signature, reference_not_saas, etc. */
  validationReason?: string | null;
  errorMessage?: string | null;
}

export interface FinalizeWebhookInput {
  outcome: PlatformWebhookOutcome;
  errorMessage?: string | null;
}

/**
 * Bitácora forense del endpoint de webhooks de plataforma (SaaS).
 *
 * Nació del incidente del 17/08/2026: Wompi aprobó un pago de $69.900, entregó
 * el webhook, el endpoint respondió 201 `{"received":true}` — y el evento no
 * dejó absolutamente ningún rastro. Ni fila de dedup (la borró el rollback de
 * la transacción de negocio, donde el INSERT vivía como paso 1), ni log (el
 * despliegue de las 15:57 destruyó el contenedor). La causa raíz del ACK vacío
 * nunca pudo probarse porque la evidencia ya no existía.
 *
 * TRES INVARIANTES, y son la razón de ser de este servicio:
 *
 *  1. `record()` escribe FUERA de cualquier `$transaction`, en su propia
 *     conexión (`GlobalPrismaService` directo, jamás un `tx` recibido por
 *     parámetro). Si la fila naciera dentro de la transacción de negocio, un
 *     rollback se la llevaría — exactamente el agujero que vino a tapar.
 *
 *  2. Ningún método de aquí puede tumbar el ACK. Todo va envuelto en
 *     try/catch: si la bitácora falla, se loguea el fallo y el webhook sigue
 *     su curso. Una bitácora que rompe el flujo que observa es peor que no
 *     tenerla.
 *
 *  3. `raw_body` va saneado. Wompi no manda PAN ni CVV, pero el contrato de
 *     esta tabla no depende de lo que Wompi mande hoy: se redacta igual.
 */
@Injectable()
export class PlatformWebhookLogService {
  private readonly logger = new Logger(PlatformWebhookLogService.name);

  /**
   * Claves que se redactan en cualquier nivel del cuerpo. `extra` es el
   * contenedor de Wompi con `bin`, `last_four`, `exp_*` y el
   * `external_identifier` (un token de fuente de pago reutilizable); nada de
   * eso hace falta para reconstruir el evento —`transaction_id`, `reference`,
   * `status` viven en columnas propias— así que se va entero en vez de
   * intentar filtrarlo campo por campo. `checksum` es la firma HMAC: se
   * redacta porque una bitácora no es sitio para firmas completas.
   */
  private static readonly REDACTED_KEYS = new Set([
    'extra',
    'checksum',
    'cvc',
    'cvv',
    'card_number',
    'number',
    'token',
    'card_token',
    'access_token',
    'private_key',
    'events_secret',
    'integrity_secret',
  ]);

  /** Corta la recursión ante cuerpos anidados absurdos o hostiles. */
  private static readonly MAX_DEPTH = 8;

  constructor(private readonly prisma: GlobalPrismaService) {}

  /**
   * Deja constancia de que el evento llegó, ANTES de intentar nada con él.
   *
   * Devuelve el id de la fila, o `null` si la escritura falló. El llamador
   * trata `null` como «sigue sin bitácora»: nunca como error.
   */
  async record(input: RecordWebhookInput): Promise<number | null> {
    try {
      const txn = input.body?.data?.transaction;
      const row = await this.prisma.platform_webhook_log.create({
        data: {
          processor: this.clip(input.processor, 64) ?? 'unknown',
          event_type: this.clip(this.asText(input.body?.event), 128),
          reference: this.clip(this.asText(txn?.reference), 255),
          transaction_id: this.clip(this.asText(txn?.id), 255),
          status: this.clip(this.asText(txn?.status), 64),
          signature_valid: input.signatureValid ?? null,
          validation_reason: this.clip(input.validationReason ?? null, 64),
          outcome: this.clip(input.outcome, 32) ?? 'acked_error',
          error_message: input.errorMessage ?? null,
          raw_body: this.sanitizeBody(input.body),
        },
        select: { id: true },
      });
      return row.id;
    } catch (error: any) {
      // Nunca propagar: el ACK vale más que la bitácora. Si esto se repite en
      // producción es señal de un problema de conexión o de esquema, y el log
      // de aplicación es el sitio correcto para gritarlo.
      this.logger.error(
        `No se pudo registrar el webhook de plataforma en platform_webhook_log ` +
          `(outcome=${input.outcome}): ${error?.message ?? error}`,
        error?.stack,
      );
      return null;
    }
  }

  /**
   * Sella la MISMA fila con el desenlace definitivo del negocio.
   *
   * Se llama después de que la transacción de negocio terminó —con éxito o
   * con excepción—, nunca dentro de ella: si el `update` viajara dentro del
   * `$transaction`, el rollback que provoca el `acked_error` borraría
   * precisamente el `acked_error`.
   */
  async finalize(
    logId: number | null,
    input: FinalizeWebhookInput,
  ): Promise<void> {
    if (logId === null) return;

    try {
      await this.prisma.platform_webhook_log.update({
        where: { id: logId },
        data: {
          outcome: this.clip(input.outcome, 32) ?? 'acked_error',
          error_message: input.errorMessage ?? null,
          processed_at: new Date(),
        },
      });
    } catch (error: any) {
      this.logger.error(
        `No se pudo sellar platform_webhook_log id=${logId} ` +
          `(outcome=${input.outcome}): ${error?.message ?? error}`,
        error?.stack,
      );
    }
  }

  /**
   * Copia defensiva del cuerpo con las claves sensibles redactadas.
   *
   * Se recorre en profundidad en vez de tocar sólo
   * `data.transaction.payment_method.extra` porque el cuerpo lo define un
   * tercero: el día que Wompi mueva ese objeto de sitio, un sanitizador
   * posicional dejaría de proteger sin fallar, que es la peor forma de fallar.
   */
  sanitizeBody(body: any): Prisma.InputJsonValue | undefined {
    if (body === undefined || body === null) return undefined;

    try {
      const cleaned = this.redact(body, 0);
      // Un cuerpo escalar (string suelto, número) es JSON válido y también hay
      // que poder guardarlo: un webhook con forma inesperada es información.
      return cleaned as Prisma.InputJsonValue;
    } catch (error: any) {
      this.logger.warn(
        `No se pudo sanear el cuerpo del webhook; se guarda un marcador: ${error?.message ?? error}`,
      );
      return { _sanitize_failed: true } as Prisma.InputJsonValue;
    }
  }

  private redact(value: any, depth: number): any {
    if (value === null || typeof value !== 'object') return value;
    if (depth >= PlatformWebhookLogService.MAX_DEPTH) return '[truncated]';

    if (Array.isArray(value)) {
      return value.map((item) => this.redact(item, depth + 1));
    }

    const out: Record<string, any> = {};
    for (const [key, val] of Object.entries(value)) {
      if (PlatformWebhookLogService.REDACTED_KEYS.has(key.toLowerCase())) {
        out[key] = '[redacted]';
        continue;
      }
      out[key] = this.redact(val, depth + 1);
    }
    return out;
  }

  /**
   * Normaliza a texto lo que venga del cuerpo. Wompi manda `id` como string,
   * pero el cuerpo es de un tercero y un número entra igual de bien; lo que no
   * puede pasar es que un tipo inesperado reviente el `create` y nos deje otra
   * vez sin fila.
   */
  private asText(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value === 'string') return value.length > 0 ? value : null;
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return null;
  }

  /**
   * Recorta al ancho de la columna. Un `value too long for type character
   * varying` es un 22001 que aborta el INSERT entero: preferimos un campo
   * recortado a no tener fila.
   */
  private clip(value: string | null, max: number): string | null {
    if (value === null || value === undefined) return null;
    return value.length > max ? value.slice(0, max) : value;
  }
}
