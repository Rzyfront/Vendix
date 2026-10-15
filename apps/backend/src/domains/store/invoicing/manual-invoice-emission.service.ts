import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ErrorCodes, VendixHttpException } from '../../../common/errors';
import { InvoicingService } from './invoicing.service';
import { InvoiceFlowService } from './invoice-flow/invoice-flow.service';

/** Fase de la emisión en la que se cortó el intento. */
export type ManualEmissionPhase = 'validate' | 'send';

/**
 * Resultado del intento de emisión inmediata de una factura manual.
 *
 * Sólo existe en la respuesta cuando el cliente pidió `emit_immediately: true`.
 * Sin el flag la respuesta de `POST /store/invoicing` es byte a byte la de
 * siempre (la factura en borrador, sin esta clave).
 */
export interface ManualEmissionOutcome {
  attempted: true;
  success: boolean;
  /** Fase que falló (`validate` = numeración/prevalidación, `send` = DIAN). `null` si salió bien. */
  phase: ManualEmissionPhase | null;
  /** Estado de la factura DESPUÉS del intento (`accepted`, `draft`, `validated`, `rejected`…). */
  status: string | null;
  error_code: string | null;
  message: string | null;
  /** Código HTTP que la emisión habría devuelto por sí sola (422 rechazo DIAN, 502 transporte…). */
  http_status: number | null;
  /** `details` cliente-seguros de la excepción (bloqueadores, `dian_errors`, `retry_scheduled`…). */
  details: Record<string, unknown> | null;
}

/**
 * Emisión inmediata de una factura MANUAL recién creada
 * (`POST /store/invoicing` con `emit_immediately: true`). El controller crea
 * con `InvoicingService.create` —sin cambios— y sólo entonces llama
 * `emitCreated`.
 *
 * QUÉ REUTILIZA
 * -------------
 * Emitir una factura en borrador desde el detalle son DOS botones del panel:
 * «Validar» (`PATCH :id/validate` → `InvoiceFlowService.validate`) y «Enviar»
 * (`PATCH :id/send` → `InvoiceFlowService.send`). Este servicio llama a esos
 * MISMOS dos métodos, en el mismo orden — es lo que ya hace
 * `CreditNotesService.issueNote` para las notas. No hay un tercer camino de
 * emisión que pueda divergir de los botones.
 *
 * POR QUÉ NUNCA PROPAGA EL ERROR DE EMISIÓN
 * -----------------------------------------
 * `InvoicingService.create()` ya escribió la factura (y su consecutivo) cuando
 * empieza la emisión. Propagar un rechazo como 4xx/5xx le diría al cliente que
 * la creación falló, y el reintento crearía una SEGUNDA factura con otro
 * consecutivo. Por eso cualquier excepción de `validate`/`send` se captura y
 * viaja en `emission`, y la respuesta es 2xx con la factura tal como quedó.
 *
 * QUÉ ESTADO QUEDA EN CADA FALLO (lo deciden `validate`/`send`, no este servicio)
 * -----------------------------------------------------------------------------
 *  - Falla `validate` (identidad, prevalidación DIAN, período cerrado…):
 *    la factura sigue en `draft`; `validate` sólo cambia el estado al final.
 *  - Falla `send` antes de transmitir (unidades, AIU, área inactiva…):
 *    queda en `validated`. Se reintenta con «Enviar» desde el detalle.
 *  - Falla de transporte / timeout DIAN: queda en `validated` con
 *    `send_status='sent_error'` y, si es transitorio, encolada para reintento
 *    automático (`details.retry_scheduled`).
 *  - Rechazo DIAN: queda en `rejected` (el consecutivo ya se transmitió). Se
 *    corrige y se reenvía con «Reenviar a la DIAN» (`rejected → sent`).
 * En todos los casos la factura existe y es recuperable desde su detalle.
 */
@Injectable()
export class ManualInvoiceEmissionService {
  private readonly logger = new Logger(ManualInvoiceEmissionService.name);

  constructor(
    private readonly invoicing_service: InvoicingService,
    private readonly invoice_flow_service: InvoiceFlowService,
  ) {}

  /** Corre validar + enviar sobre una factura recién creada. Nunca lanza. */
  async emitCreated(
    created: { id: number; status?: string | null } & Record<string, any>,
  ): Promise<{ invoice: Record<string, any>; emission: ManualEmissionOutcome }> {
    let phase: ManualEmissionPhase = 'validate';
    try {
      if (created.status == null || created.status === 'draft') {
        await this.invoice_flow_service.validate(created.id);
      }
      phase = 'send';
      const sent = await this.invoice_flow_service.send(created.id);
      return {
        invoice: sent,
        emission: {
          attempted: true,
          success: true,
          phase: null,
          status: (sent as any)?.status ?? null,
          error_code: null,
          message: null,
          http_status: null,
          details: null,
        },
      };
    } catch (error) {
      const failure = this.describeError(error);
      this.logger.warn(
        `Invoice #${created.id} created but immediate emission failed at ${phase}: ` +
          `${failure.error_code ?? 'no-code'} ${failure.raw_message}`,
      );

      // Releer: `validate` pudo numerar y `send` pudo dejar `rejected` o
      // `send_status='sent_error'`. Devolver el objeto de la creación mostraría
      // un `draft` que ya no es cierto.
      const current = await this.reloadSafely(created);
      return {
        invoice: current,
        emission: {
          attempted: true,
          success: false,
          phase,
          status: (current as any)?.status ?? null,
          error_code: failure.error_code,
          message: failure.message,
          http_status: failure.http_status,
          details: failure.details,
        },
      };
    }
  }

  private async reloadSafely(created: Record<string, any>) {
    try {
      return (await this.invoicing_service.findOne(created.id)) ?? created;
    } catch (reload_error) {
      this.logger.error(
        `Invoice #${created.id}: could not reload after failed emission: ${
          reload_error instanceof Error ? reload_error.message : String(reload_error)
        }`,
      );
      return created;
    }
  }

  private describeError(error: unknown): {
    error_code: string | null;
    message: string;
    raw_message: string;
    http_status: number | null;
    details: Record<string, unknown> | null;
  } {
    if (error instanceof VendixHttpException) {
      const resp = error.getResponse() as any;
      const message =
        typeof resp?.message === 'string' ? resp.message : error.message;
      return {
        error_code: error.errorCode,
        message,
        raw_message: message,
        http_status: error.getStatus(),
        details:
          resp?.details && typeof resp.details === 'object' ? resp.details : null,
      };
    }

    if (error instanceof HttpException) {
      const resp = error.getResponse() as any;
      const raw =
        resp && typeof resp === 'object'
          ? (resp.message ?? resp.error ?? error.message)
          : (resp ?? error.message);
      const message = Array.isArray(raw)
        ? raw.join('; ')
        : typeof raw === 'string'
          ? raw
          : error.message;
      return {
        error_code:
          typeof resp?.error_code === 'string'
            ? resp.error_code
            : Array.isArray(raw)
              ? ErrorCodes.SYS_VALIDATION_001.code
              : null,
        message,
        raw_message: message,
        http_status: error.getStatus(),
        details:
          resp?.details && typeof resp.details === 'object' ? resp.details : null,
      };
    }

    // Error no tipado: el mensaje crudo puede traer SQL o internos, así que va
    // sólo al log. Al cliente le llega lo mismo que el filtro global daría.
    const raw_message = error instanceof Error ? error.message : String(error);
    return {
      error_code: ErrorCodes.SYS_INTERNAL_001.code,
      message:
        'La factura quedó creada, pero la emisión falló por un error inesperado. Puedes reintentarla desde el detalle de la factura.',
      raw_message,
      http_status: ErrorCodes.SYS_INTERNAL_001.httpStatus,
      details: null,
    };
  }
}
