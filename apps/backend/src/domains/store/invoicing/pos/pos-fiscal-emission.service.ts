import { Injectable, Logger } from '@nestjs/common';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { InvoicingService } from '../invoicing.service';
import { InvoiceFlowService } from '../invoice-flow/invoice-flow.service';
import { InvoiceRetryQueueService } from '../services/invoice-retry-queue.service';
import { FiscalDocumentFinding } from '../validators/fiscal-document.validator';
import { PosFiscalState, PosFiscalStatus } from './pos-fiscal-status.interface';

/**
 * EL CARRIL DE EMISIÓN DEL POS.
 *
 * ## La única regla que lo define
 *
 * **La venta ya está hecha.** Cuando este servicio corre, el cobro está
 * confirmado, el inventario descontado y la caja cuadrada. Por eso NADA de lo
 * que pase aquí puede propagarse hacia arriba: un timeout de la DIAN, un
 * certificado vencido o una caída de red no pueden dejar al cajero sin poder
 * cobrar al siguiente cliente. Todos los métodos públicos devuelven un ESTADO,
 * nunca lanzan por un fallo de emisión.
 *
 * ## Lo que NO cambia respecto del carril fiscal
 *
 * El motor es el mismo (`InvoicingService.createFromOrder` →
 * `InvoiceFlowService.validate` → `.send`) y la puerta de validación es la misma
 * (`validators/fiscal-document.validator.ts`, aplicada dentro de `validate()`).
 * Lo único que cambia entre superficies es QUÉ SE CAPTURA y QUÉ SE HACE ANTE EL
 * FALLO. Duplicar reglas por superficie fue exactamente cómo se llegó a que el
 * CUFE y el XML clasificaran impuestos distinto, y eso ya se pagó una vez en
 * este dominio.
 *
 * ## Por qué el consecutivo no se quema
 *
 * `createFromOrder` asigna el número ANTES de prevalidar (el generador lo
 * consume bajo un lock de resolución, ver `invoice-number-generator.ts`), así
 * que la secuencia importa:
 *
 * 1. **Elegibilidad primero.** Si la tienda no puede emitir —área fiscal
 *    inactiva o habilitación DIAN sin terminar— se sale ANTES de crear nada.
 *    Ésta es la compuerta de `invoicing.service.ts` y se consulta, no se copia.
 * 2. **Un documento por pedido.** Si ya hay una factura para el pedido se
 *    reutiliza; no se crea una segunda que gastaría un número nuevo.
 * 3. **Prevalidación bloqueante ⇒ NO se transmite.** El documento se queda en
 *    `draft` CON SU NÚMERO RESERVADO. Reemitir después de corregir reusa ese
 *    mismo borrador, así que el consecutivo no se pierde: sólo se pierde si el
 *    borrador se abandona. Un rechazo de la DIAN, en cambio, gasta el
 *    consecutivo de forma irrecuperable y deja un hueco que hay que justificar
 *    — por eso relajar la validación aquí sería el peor negocio posible.
 */
@Injectable()
export class PosFiscalEmissionService {
  private readonly logger = new Logger(PosFiscalEmissionService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly invoicing: InvoicingService,
    private readonly invoice_flow: InvoiceFlowService,
    private readonly retry_queue: InvoiceRetryQueueService,
  ) {}

  /**
   * Emite (o reintenta) el documento fiscal de una venta de mostrador.
   *
   * Devuelve SIEMPRE un estado. Los únicos lanzamientos posibles son de
   * contrato —pedido inexistente o de otra tienda—, no de emisión.
   */
  async emitForOrder(order_id: number): Promise<PosFiscalStatus> {
    // Un solo punto de salida para que TODA rama que termine en `failed` —la
    // creación, la prevalidación, la transmisión— deje su constancia por el
    // mismo sitio. Registrarlo en cada `return this.failed(...)` era invitar a
    // que la próxima rama nueva se olvidara, y la rama olvidada sería
    // precisamente una venta sin documento de la que nadie se entera.
    return this.registerFailure(await this.runEmission(order_id), order_id);
  }

  private async runEmission(order_id: number): Promise<PosFiscalStatus> {
    const order = await this.prisma.orders.findFirst({
      where: { id: order_id },
      select: { id: true },
    });

    // El cliente scoped ya filtra por tienda: un pedido de otro tenant no
    // aparece, así que "no existe" y "no es tuyo" colapsan en el mismo 404 sin
    // filtrar la existencia del ajeno.
    if (!order) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_FIND_003,
        `No se encontró el pedido #${order_id} en esta tienda, así que no hay venta que facturar.`,
        { order_id },
      );
    }

    const existing = await this.findLatestSalesInvoice(order_id);

    // Ya aceptado: no hay nada que hacer y volver a transmitir sería emitir dos
    // veces el mismo hecho económico.
    if (existing?.status === 'accepted') {
      return this.buildStatus(order_id, existing, []);
    }

    let invoice = existing;

    if (!invoice) {
      const eligibility =
        await this.invoicing.getElectronicEmissionEligibility();
      if (!eligibility.eligible) {
        return this.notApplicable(order_id, eligibility.reason);
      }

      try {
        // AQUÍ se consume el consecutivo. Todo lo que pudiera impedir la
        // emisión y sea barato de comprobar ya se comprobó arriba.
        const created = await this.invoicing.createFromOrder(order_id);
        invoice = await this.findLatestSalesInvoice(order_id);
        if (!invoice) {
          // Defensivo: `createFromOrder` acaba de escribir la fila, así que no
          // encontrarla sólo puede ser un problema de alcance. Se reporta como
          // fallo en vez de seguir con un `null`.
          return this.failed(
            order_id,
            null,
            `La factura ${created.invoice_number} se creó pero no se pudo releer en el alcance de la tienda.`,
          );
        }
      } catch (error) {
        return this.failed(
          order_id,
          null,
          this.describe(error),
          this.blockersOf(error),
        );
      }
    }

    // PUERTA ÚNICA DE VALIDACIÓN. `validate()` corre identidad del adquiriente
    // + prevalidación fiscal DIAN. Que falle NO tumba la venta, pero tampoco se
    // transmite: un documento que el prevalidador rechaza sería un rechazo de
    // la DIAN con consecutivo gastado.
    if (invoice.status === 'draft') {
      const draft = invoice;
      try {
        await this.invoice_flow.validate(draft.id);
        const revalidated = await this.findLatestSalesInvoice(order_id);
        if (!revalidated) {
          return this.failed(
            order_id,
            draft,
            'No se pudo releer el documento fiscal después de validarlo.',
          );
        }
        invoice = revalidated;
      } catch (error) {
        this.logger.warn(
          `POS: la factura #${draft.id} del pedido #${order_id} no pasó la prevalidación: ${this.describe(error)}`,
        );
        return this.failed(
          order_id,
          draft,
          this.describe(error),
          this.blockersOf(error),
        );
      }
    }

    // `validated` es el estado normal tras prevalidar; `rejected` vuelve a ser
    // transmisible porque la máquina de estados lo permite (rejected → sent)
    // una vez corregida la causa.
    if (invoice.status === 'validated' || invoice.status === 'rejected') {
      try {
        await this.invoice_flow.send(invoice.id);
      } catch (error) {
        // El motor ya decidió qué hacer con el fallo ANTES de que llegara acá:
        // si era transitorio lo encoló, y si la DIAN no estaba disponible
        // declaró contingencia. Releer la fila es lo que distingue «se
        // reintentará solo» de «hay que corregirlo», sin volver a juzgarlo.
        this.logger.warn(
          `POS: la transmisión de la factura #${invoice.id} (pedido #${order_id}) falló: ${this.describe(error)}`,
        );
        const after = await this.findLatestSalesInvoice(order_id);
        return this.buildStatus(order_id, after, [], this.describe(error));
      }
    }

    return this.buildStatus(order_id, await this.findLatestSalesInvoice(order_id), []);
  }

  /**
   * El estado fiscal del pedido SIN emitir nada. Es lo que consulta el
   * indicador del POS mientras el documento va en camino.
   */
  async getStatusForOrder(order_id: number): Promise<PosFiscalStatus> {
    const invoice = await this.findLatestSalesInvoice(order_id);

    if (!invoice) {
      const eligibility = await this.invoicing.getElectronicEmissionEligibility();
      if (!eligibility.eligible) {
        return this.notApplicable(order_id, eligibility.reason);
      }
      // Elegible y todavía sin documento: la emisión va en camino. Decir
      // «pendiente» es la lectura honesta — el carril del POS es asíncrono por
      // diseño y el documento aparece unos segundos después del cobro.
      return {
        ...this.emptyStatus(order_id),
        state: 'pending',
        message: 'Emitiendo el documento electrónico…',
        invoice_data_token: await this.findInvoiceDataToken(order_id),
      };
    }

    return this.buildStatus(order_id, invoice, []);
  }

  // ---------------------------------------------------------------------------
  // Lectura
  // ---------------------------------------------------------------------------

  /**
   * La factura de venta más reciente del pedido.
   *
   * `orders.id` no es único en `invoices.order_id`: una conversión a factura
   * nominativa deja la original más la nueva. La reciente es la vigente.
   */
  private async findLatestSalesInvoice(order_id: number) {
    return this.prisma.invoices.findFirst({
      where: { order_id, invoice_type: 'sales_invoice' },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        invoice_number: true,
        status: true,
        transmission_status: true,
        cufe: true,
        pdf_url: true,
        contingency_deadline: true,
      },
    });
  }

  /** Token de la solicitud de datos vigente (carril nominativo diferido). */
  private async findInvoiceDataToken(order_id: number): Promise<string | null> {
    const request = await this.prisma.invoice_data_requests.findFirst({
      where: { order_id, status: { in: ['pending', 'submitted'] } },
      orderBy: { created_at: 'desc' },
      select: { token: true },
    });
    return request?.token ?? null;
  }

  // ---------------------------------------------------------------------------
  // Composición del estado
  // ---------------------------------------------------------------------------

  private async buildStatus(
    order_id: number,
    invoice: Awaited<ReturnType<PosFiscalEmissionService['findLatestSalesInvoice']>>,
    blockers: FiscalDocumentFinding[],
    failure_message?: string,
  ): Promise<PosFiscalStatus> {
    if (!invoice) {
      return this.failed(
        order_id,
        null,
        failure_message ?? 'El pedido no tiene documento fiscal.',
        blockers,
      );
    }

    const retry_by_invoice = await this.retry_queue.getRetryStatusByInvoiceIds([
      invoice.id,
    ]);
    const retry_row = retry_by_invoice.get(invoice.id) ?? null;
    const retry_alive =
      retry_row && ['pending', 'processing'].includes(retry_row.status)
        ? {
            attempts: retry_row.attempts,
            max_attempts: retry_row.max_attempts,
            next_retry_at: retry_row.next_retry_at,
            last_error: retry_row.last_error,
          }
        : null;

    // Constancia terminal: la fila existe pero ya no reintenta. Cubre los dos
    // desenlaces que dejan a un documento esperando una mano humana —el
    // bloqueado por prevalidación (`recordBlocked`, attempts 0) y el que agotó
    // su cadencia— y es lo que impide que el sondeo del POS siga diciendo
    // «emitiendo…» sobre un `draft` que nadie va a mover.
    const retry_blocked =
      retry_row && retry_row.status === 'failed' ? retry_row : null;

    const { state, message } = this.deriveState(
      invoice,
      Boolean(retry_alive),
      failure_message,
      retry_blocked?.last_error ?? null,
    );

    return {
      order_id,
      state,
      message,
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
      invoice_status: invoice.status,
      cufe: invoice.cufe,
      pdf_url: invoice.pdf_url,
      blockers,
      retry: retry_alive,
      contingency_deadline: invoice.contingency_deadline,
      invoice_data_token: await this.findInvoiceDataToken(order_id),
    };
  }

  /**
   * De la fila al semáforo del POS.
   *
   * El orden de las ramas ES la regla: la contingencia se lee ANTES que
   * cualquier fallo porque un documento bajo contingencia NO está fallido —
   * está expedido legítimamente y con una obligación de 48 h. Tratarlo como
   * error mandaría al cajero a corregir algo que no está roto.
   */
  private deriveState(
    invoice: {
      status: string;
      transmission_status: string | null;
      cufe: string | null;
    },
    has_live_retry: boolean,
    failure_message?: string,
    blocked_error?: string | null,
  ): { state: PosFiscalState; message: string } {
    if (invoice.status === 'accepted') {
      return { state: 'issued', message: 'Documento aceptado por la DIAN.' };
    }

    if (invoice.transmission_status === 'contingency') {
      return {
        state: 'contingency',
        message:
          'La DIAN no estaba disponible: el documento se expidió bajo contingencia y se transmitirá automáticamente.',
      };
    }

    if (has_live_retry) {
      return {
        state: 'pending',
        message: 'La DIAN no respondió; el documento se reintentará solo.',
      };
    }

    // Antes de la rama de abajo: un documento con constancia terminal en la
    // cola sigue siendo `draft` o `validated`, y esos estados caían en el
    // «sigue en curso» del final. El indicador del POS sondea mientras lea
    // `pending`, así que un documento bloqueado se leía como uno en camino
    // hasta que el cajero cerraba la pantalla — que es exactamente el olvido
    // que `recordBlocked` existe para impedir. Va DESPUÉS de `has_live_retry`
    // porque un reintento vivo describe mejor la situación que la última
    // constancia terminal, y DESPUÉS de contingencia porque un documento en
    // contingencia no está fallido.
    if (blocked_error) {
      return { state: 'failed', message: failure_message ?? blocked_error };
    }

    if (invoice.status === 'rejected') {
      return {
        state: 'failed',
        message:
          failure_message ?? 'La DIAN rechazó el documento. Revisa la factura para corregirlo.',
      };
    }

    if (invoice.status === 'cancelled' || invoice.status === 'voided') {
      return {
        state: 'failed',
        message: 'El documento fiscal de esta venta fue anulado.',
      };
    }

    // `failure_message` SÓLO llega poblado desde el catch de `send()` en
    // `runEmission` — es la única vía que lo puebla en todo el archivo (ver
    // los demás llamados a `buildStatus`, que nunca lo pasan). Que llegue acá
    // significa que YA HUBO un intento de transmisión que lanzó, y que no lo
    // rescató ninguna rama anterior: ni contingencia, ni reintento vivo, ni un
    // `rejected` con respuesta de la DIAN. Eso es un fallo permanente — el
    // motor decidió no reintentarlo solo (`isTransientError` dio `false`, o el
    // error traía su propio código tipado) — y no «sigue en curso» aunque el
    // `status` de la fila no se haya movido de `validated`. Devolver
    // `pending` aquí era el defecto original: el cajero veía «Enviando a la
    // DIAN…» sobre un documento que no iba a salir nunca, y `registerFailure`
    // —que sólo actúa sobre `state === 'failed'`— nunca dejaba constancia.
    if (failure_message) {
      return { state: 'failed', message: failure_message };
    }

    // draft / validated / sent sin ningún intento fallido ni reintento vivo:
    // sigue en curso de verdad.
    return {
      state: 'pending',
      message: 'Emitiendo el documento electrónico…',
    };
  }

  private notApplicable(order_id: number, reason: string | null): PosFiscalStatus {
    return {
      ...this.emptyStatus(order_id),
      state: 'not_applicable',
      message:
        reason ??
        'Esta tienda no emite facturación electrónica, así que la venta no genera documento DIAN.',
    };
  }

  private failed(
    order_id: number,
    invoice: { id: number; invoice_number: string; status: string } | null,
    message: string,
    blockers: FiscalDocumentFinding[] = [],
  ): PosFiscalStatus {
    return {
      ...this.emptyStatus(order_id),
      state: 'failed',
      message,
      invoice_id: invoice?.id ?? null,
      invoice_number: invoice?.invoice_number ?? null,
      invoice_status: invoice?.status ?? null,
      blockers,
    };
  }

  /**
   * Deja constancia consultable de un documento que quedó sin emitir.
   *
   * ## Por qué esto no es opcional aunque no bloquee nada
   *
   * Que la venta no se bloquee es el punto del carril; que el fallo se olvide,
   * no. Antes de esto, un documento rechazado por la prevalidación existía
   * únicamente como una advertencia en el log y como un `draft` con su
   * consecutivo reservado: no aparecía en `getQueueStats()`, ni en el
   * `retry_status` del listado de facturas, ni —en cuanto el cajero pasaba a la
   * siguiente venta— en ninguna pantalla. El indicador del POS es efímero por
   * diseño; hacía falta algo que sobreviviera a él.
   *
   * Se registra como bloqueado y NO como reintento pendiente porque a este
   * documento le falta un dato, y eso no lo cura repetir el envío: cinco
   * intentos contra la DIAN fallarían igual y el indicador le diría al cajero
   * que espere algo que no va a ocurrir. Ver `recordBlocked`.
   *
   * La política de la tienda (`store_settings.invoicing.pos.on_failure`) puede
   * apagarlo con `'ignore'`. Nunca puede hacer que el fallo bloquee la venta:
   * ese valor no existe, y cuando este método corre el cobro ya está confirmado
   * en base de datos.
   */
  private async registerFailure(
    status: PosFiscalStatus,
    order_id: number,
  ): Promise<PosFiscalStatus> {
    if (status.state !== 'failed' || status.invoice_id === null) return status;

    try {
      const policy = await this.invoicing.getPosInvoicingSettings();
      if (policy.on_failure === 'ignore') return status;

      const invoice = await this.prisma.invoices.findFirst({
        where: { id: status.invoice_id },
        select: { id: true, organization_id: true, store_id: true },
      });
      if (!invoice) return status;

      await this.retry_queue.recordBlocked(
        invoice.id,
        invoice.organization_id,
        invoice.store_id,
        status.message,
      );
    } catch (error) {
      // Anotar el fallo no puede convertirse en un segundo fallo que tape al
      // primero: el estado que ya se compuso es lo que el cajero necesita ver.
      this.logger.error(
        `POS: no se pudo registrar el fallo fiscal del pedido #${order_id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return status;
  }

  private emptyStatus(order_id: number): PosFiscalStatus {
    return {
      order_id,
      state: 'pending',
      message: '',
      invoice_id: null,
      invoice_number: null,
      invoice_status: null,
      cufe: null,
      pdf_url: null,
      blockers: [],
      retry: null,
      contingency_deadline: null,
      invoice_data_token: null,
    };
  }

  // ---------------------------------------------------------------------------
  // Traducción de errores
  // ---------------------------------------------------------------------------

  /**
   * El mensaje que ve el cajero. Un `VendixHttpException` ya trae uno redactado
   * en español que dice qué falta y dónde arreglarlo; lo demás se degrada al
   * `message` crudo antes que a una frase genérica.
   */
  private describe(error: unknown): string {
    if (error instanceof VendixHttpException) {
      const body = error.getResponse();
      if (body && typeof body === 'object' && 'message' in body) {
        const message = (body as { message?: unknown }).message;
        if (typeof message === 'string' && message.trim()) return message;
      }
    }
    if (error instanceof Error && error.message.trim()) return error.message;
    return 'No se pudo emitir el documento electrónico de esta venta.';
  }

  /**
   * Los bloqueantes del validador único, si el error los traía.
   *
   * `validate()` los adjunta en `details.blockers` con `problem` y `fix`. Se
   * leen a la defensiva: `details` es una bolsa libre y este es el peor sitio
   * donde puede romperse algo — la ruta de error de una venta ya cobrada.
   */
  private blockersOf(error: unknown): FiscalDocumentFinding[] {
    if (!(error instanceof VendixHttpException)) return [];
    const body = error.getResponse();
    if (!body || typeof body !== 'object') return [];
    const details = (body as { details?: unknown }).details;
    if (!details || typeof details !== 'object') return [];
    const blockers = (details as { blockers?: unknown }).blockers;
    return Array.isArray(blockers) ? (blockers as FiscalDocumentFinding[]) : [];
  }
}
