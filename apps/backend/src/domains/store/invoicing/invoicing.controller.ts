import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  UseGuards,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import {
  ModuleFlowGuard,
  RequireModuleFlow,
} from '../../../common/guards/module-flow.guard';
import { InvoicingService } from './invoicing.service';
import { InvoiceFlowService } from './invoice-flow/invoice-flow.service';
import { CreditNotesService } from './credit-notes/credit-notes.service';
import { InvoicePdfService } from './services/invoice-pdf.service';
import { DianEventsService } from './services/dian-events.service';
import {
  PRINT_FORMATS,
  PrintFormat,
} from '../settings/interfaces/store-settings.interface';
import { ResponseService } from '../../../common/responses/response.service';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import {
  QueryInvoiceDto,
  QueryInvoiceStatsDto,
} from './dto/query-invoice.dto';
import { QueryExchangeRateDto } from './dto/query-exchange-rate.dto';
import {
  CreateCreditNoteDto,
  CreateDebitNoteDto,
} from './credit-notes/dto/create-credit-note.dto';
import { RegisterDianEventDto } from './dto/register-dian-event.dto';

/*
 * NOTA sobre el guard: hasta este cambio la clase no declaraba `PermissionsGuard`,
 * así que los `@Permissions` de abajo eran decoración inerte —Nest sólo los lee si
 * hay un guard que los consulte—. Verificado empíricamente: un usuario de rol
 * `cashier` sin un solo permiso `invoicing:*` obtenía 200 en las lecturas y
 * alcanzaba la capa de servicio en los `DELETE` (404 con `error_code` de dominio,
 * prueba de que la autorización no se evaluaba). No es un permiso nuevo ni una
 * restricción nueva: es hacer efectiva la que el archivo ya declaraba. Mismo
 * criterio que `pos/pos-fiscal.controller.ts`.
 */
@Controller('store/invoicing')
@UseGuards(ModuleFlowGuard, PermissionsGuard)
@RequireModuleFlow('invoicing')
export class InvoicingController {
  constructor(
    private readonly invoicing_service: InvoicingService,
    private readonly invoice_flow_service: InvoiceFlowService,
    private readonly credit_notes_service: CreditNotesService,
    private readonly invoice_pdf_service: InvoicePdfService,
    private readonly dian_events_service: DianEventsService,
    private readonly response_service: ResponseService,
  ) {}

  @Get()
  @Permissions('invoicing:read')
  async findAll(@Query() query_dto: QueryInvoiceDto) {
    const result = await this.invoicing_service.findAll(query_dto);
    return this.response_service.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
    );
  }

  // --- Static Routes (MUST be before :id) ---

  @Get('stats')
  @Permissions('invoicing:read')
  async getStats(@Query() query: QueryInvoiceStatsDto) {
    const result = await this.invoicing_service.getStats(
      query.date_from,
      query.date_to,
    );
    return this.response_service.success(result);
  }

  /**
   * Tasa de cambio oficial para el grupo `cac:PaymentExchangeRate` (FAR02-FAR07).
   *
   * SÓLO LEE. `invoicing:read` y no `:write` porque el formulario la consulta
   * mientras el usuario todavía está capturando: exigir permiso de escritura
   * dejaría el campo vacío para quien puede mirar una factura pero no crearla.
   *
   * Responde `rate: null` sin error en los tres casos legítimos en que no hay
   * tasa que declarar (COP, divisa ≠ USD sin cotización cruzada, `datos.gov.co`
   * caído). Ver `InvoicingService.getExchangeRateQuote`.
   */
  @Get('exchange-rate')
  @Permissions('invoicing:read')
  async getExchangeRate(@Query() query: QueryExchangeRateDto) {
    const result = await this.invoicing_service.getExchangeRateQuote(query);
    return this.response_service.success(result);
  }

  /**
   * Límite 5 UVT vigente para el documento equivalente POS (Art. 616-1 ET).
   *
   * El POS lo consulta para AVISAR antes de que el cajero llegue al tope; el
   * bloqueo real vive en la transacción de venta, así que este endpoint es una
   * ayuda de UI y no una autorización.
   */
  @Get('uvt-threshold')
  @Permissions('invoicing:read')
  async getUvtThreshold() {
    const result = await this.invoicing_service.getPosUvtThreshold();
    return this.response_service.success(result);
  }

  /**
   * Configuración AIU EFECTIVA de la tienda, resuelta con los mismos defaults
   * que aplica el motor de cálculo.
   *
   * Existe porque la base gravable AIU es indeducible desde el documento: bajo
   * E.T. art. 462-1 grava el AIU completo y bajo Decreto 1372/1992 grava sólo
   * la Utilidad, y el formulario no puede instruir al comerciante sin saber
   * cuál rige. Un texto fijo en la UI —cualquiera de los dos— le dice a la
   * mitad de las tiendas que graven mal, y como la DIAN acepta el documento el
   * error sólo aparece en una fiscalización.
   *
   * `invoicing:read` y NO `store:settings:read` a propósito: quien captura una
   * factura no necesariamente administra la tienda, y colgar esta lectura del
   * permiso de configuración dejaría el aviso en blanco justo para el perfil
   * que más lo necesita.
   */
  @Get('aiu-settings')
  @Permissions('invoicing:read')
  async getAiuSettings() {
    const result = await this.invoicing_service.getAiuSettingsView();
    return this.response_service.success(result);
  }

  @Post()
  @Permissions('invoicing:write')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() create_dto: CreateInvoiceDto) {
    const result = await this.invoicing_service.create(create_dto);
    return this.response_service.success(
      result,
      'Invoice created successfully',
    );
  }

  @Post('from-order/:orderId')
  @Permissions('invoicing:write')
  @HttpCode(HttpStatus.CREATED)
  async createFromOrder(@Param('orderId', ParseIntPipe) order_id: number) {
    const result = await this.invoicing_service.createFromOrder(order_id);
    return this.response_service.success(
      result,
      'Invoice created from order successfully',
    );
  }

  @Post('from-sales-order/:salesOrderId')
  @Permissions('invoicing:write')
  @HttpCode(HttpStatus.CREATED)
  async createFromSalesOrder(
    @Param('salesOrderId', ParseIntPipe) sales_order_id: number,
  ) {
    const result =
      await this.invoicing_service.createFromSalesOrder(sales_order_id);
    return this.response_service.success(
      result,
      'Invoice created from sales order successfully',
    );
  }

  @Post('credit-notes')
  @Permissions('invoicing:write')
  @HttpCode(HttpStatus.CREATED)
  async createCreditNote(@Body() create_dto: CreateCreditNoteDto) {
    const result = await this.credit_notes_service.createCreditNote(create_dto);
    return this.response_service.success(
      result,
      'Credit note created successfully',
    );
  }

  @Post('debit-notes')
  @Permissions('invoicing:write')
  @HttpCode(HttpStatus.CREATED)
  async createDebitNote(@Body() create_dto: CreateDebitNoteDto) {
    const result = await this.credit_notes_service.createDebitNote(create_dto);
    return this.response_service.success(
      result,
      'Debit note created successfully',
    );
  }

  /**
   * Sample invoice in the requested paper format, so the merchant can check the
   * layout before saving the setting. Streams the PDF instead of persisting it:
   * no numbering is consumed and nothing is stored.
   *
   * Declared before the parameter routes, like every literal path in this
   * controller — `:id` would otherwise match `pdf-preview`.
   */
  @Get('pdf-preview')
  @Permissions('invoicing:read')
  async previewInvoicePdf(
    @Query('format') format: string | undefined,
    @Res() res: Response,
  ) {
    const requested = (format ?? 'letter') as PrintFormat;
    const safe_format: PrintFormat = PRINT_FORMATS.includes(requested)
      ? requested
      : 'letter';

    const buffer = await this.invoice_pdf_service.previewPdf(safe_format);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="muestra-${safe_format}.pdf"`,
    );
    res.send(buffer);
  }

  // --- Parameter Routes (MUST be last) ---
  //
  // Todos los `:id` de aquí abajo pasan por `ParseIntPipe`, igual que en
  // `DianConfigController`. Con `+id` a secas, un identificador no numérico se
  // convertía en `NaN` y viajaba hasta el campo `Int` de Prisma, que respondía
  // con `PrismaClientValidationError` — un 500 sobre lo que en realidad es una
  // petición mal formada. El mismo endpoint con un id numérico inexistente ya
  // contestaba 404, así que lo único que faltaba era rechazar el texto en la
  // puerta: el pipe devuelve 400 y el servicio nunca llega a verlo.

  @Get(':id/pdf')
  @Permissions('invoicing:read')
  async getInvoicePdf(@Param('id', ParseIntPipe) id: number) {
    const url = await this.invoice_pdf_service.getPdf(id);
    return this.response_service.success({ url });
  }

  @Post(':id/pdf/regenerate')
  @Permissions('invoicing:write')
  async regenerateInvoicePdf(@Param('id', ParseIntPipe) id: number) {
    const result = await this.invoice_pdf_service.generatePdf(id);
    return this.response_service.success(result, 'Invoice PDF regenerated');
  }

  /**
   * RADIAN document events (Res. 000085/2022). Registered against an invoice
   * DIAN already accepted; they never move the invoice's own state machine.
   */
  @Get(':id/events')
  @Permissions('invoicing:read')
  async listDianEvents(@Param('id', ParseIntPipe) id: number) {
    const result = await this.dian_events_service.findByInvoice(id);
    return this.response_service.success(result);
  }

  @Post(':id/events')
  @Permissions('invoicing:write')
  @HttpCode(HttpStatus.OK)
  async registerDianEvent(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RegisterDianEventDto,
  ) {
    const result = await this.dian_events_service.register(id, dto);
    return this.response_service.success(
      result,
      `Evento RADIAN ${dto.event_code} procesado`,
    );
  }

  /**
   * Qué le falta al documento para poder emitirse, sin cambiar nada.
   *
   * Se declara ANTES de `@Get(':id')` a propósito: Nest resuelve las rutas por
   * orden de declaración, y `:id` con un segmento extra no colisiona, pero
   * mantener las rutas específicas arriba es lo que evita que un `:id`
   * demasiado laxo se coma una ruta hermana el día que alguien la agregue.
   *
   * Es de lectura (`invoicing:read`): consultar si una factura está lista no
   * debería exigir permiso de escritura — quien la revisa no siempre es quien
   * la emite.
   */
  @Get(':id/emit-readiness')
  @Permissions('invoicing:read')
  async getEmitReadiness(@Param('id', ParseIntPipe) id: number) {
    const result = await this.invoice_flow_service.getEmitReadiness(id);
    return this.response_service.success(result);
  }

  @Get(':id')
  @Permissions('invoicing:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const result = await this.invoicing_service.findOne(id);
    return this.response_service.success(result);
  }

  @Patch(':id')
  @Permissions('invoicing:write')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() update_dto: UpdateInvoiceDto,
  ) {
    const result = await this.invoicing_service.update(id, update_dto);
    return this.response_service.success(
      result,
      'Invoice updated successfully',
    );
  }

  @Patch(':id/validate')
  @Permissions('invoicing:write')
  async validate(@Param('id', ParseIntPipe) id: number) {
    const result = await this.invoice_flow_service.validate(id);
    return this.response_service.success(
      result,
      'Invoice validated successfully',
    );
  }

  @Patch(':id/send')
  @Permissions('invoicing:write')
  async send(@Param('id', ParseIntPipe) id: number) {
    const result = await this.invoice_flow_service.send(id);
    return this.response_service.success(result, 'Invoice sent successfully');
  }

  @Patch(':id/accept')
  @Permissions('invoicing:write')
  async accept(@Param('id', ParseIntPipe) id: number) {
    const result = await this.invoice_flow_service.accept(id);
    return this.response_service.success(
      result,
      'Invoice accepted successfully',
    );
  }

  @Patch(':id/reject')
  @Permissions('invoicing:write')
  async reject(@Param('id', ParseIntPipe) id: number) {
    const result = await this.invoice_flow_service.reject(id);
    return this.response_service.success(
      result,
      'Invoice rejected successfully',
    );
  }

  @Patch(':id/cancel')
  @Permissions('invoicing:write')
  async cancel(@Param('id', ParseIntPipe) id: number) {
    const result = await this.invoice_flow_service.cancel(id);
    return this.response_service.success(
      result,
      'Invoice cancelled successfully',
    );
  }

  @Patch(':id/void')
  @Permissions('invoicing:write')
  async voidInvoice(@Param('id', ParseIntPipe) id: number) {
    const result = await this.invoice_flow_service.void(id);
    return this.response_service.success(result, 'Invoice voided successfully');
  }

  @Delete(':id')
  @Permissions('invoicing:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.invoicing_service.remove(id);
    return this.response_service.success(null, 'Invoice deleted successfully');
  }
}
