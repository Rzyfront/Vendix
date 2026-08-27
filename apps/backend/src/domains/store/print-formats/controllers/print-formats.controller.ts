import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { print_format_type_enum } from '@prisma/client';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { RequestContextService } from '@common/context/request-context.service';
import { ResponseService } from '@common/responses/response.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
// CP-DTLP-20260827 — IDOR fix (H-1). The interceptor refuses any render
// whose `x-store-id` belongs to a different organization than the JWT.
// Mounted at controller scope so the library/CRUD endpoints that do NOT
// read `x-store-id` keep their original behaviour.
import { StoreTenantInterceptor } from '@common/middleware/store-tenant.interceptor';
import { PrintFormatsService } from '../services/print-formats.service';
import { PrintGatewayService } from '../services/print-gateway.service';
// [print-editor-dsk P3.1] — Servicio que alimenta el picker de
// documentos recientes del editor con documentos REALES de la tienda.
import { DocumentIndexService } from '../services/document-index.service';
import {
  UpdatePrintFormatConfigDto,
  PrintPreviewRequestDto,
} from '../dto/print-format-config.dto';
import { RenderPrintDocumentDto } from '../dto/print-render.dto';

@ApiTags('Store Print Formats Hub')
@Controller('store/print-formats')
@UseGuards(PermissionsGuard)
@UseInterceptors(StoreTenantInterceptor)
export class PrintFormatsController {
  constructor(
    private readonly printFormatsService: PrintFormatsService,
    private readonly gatewayService: PrintGatewayService,
    private readonly responseService: ResponseService,
    // [print-editor-dsk P3.1] — Inyectado para servir el endpoint
    // `GET /:formatType/documents`. El servicio es independiente del
    // gateway: el gateway sigue llamando `fetchDocumentData` cuando el
    // usuario ya eligió un documento.
    private readonly documentIndexService: DocumentIndexService,
  ) {}

  @Get()
  @Permissions('store:settings:read', 'invoicing:read')
  // `invoicing:read` se suma el 2026-08-24: medido que un usuario con SOLO ese
  // permiso (quien factura, no quien administra ajustes de tienda) recibía
  // 403 al abrir el selector de formato en la pantalla de factura, que
  // quedaba en blanco sin ninguna explicación (E.1). Es lectura pura —no
  // cambia nada— así que ampliar a quien factura no abre superficie de
  // escritura.
  @ApiOperation({ summary: 'List all print format types and their status for the store' })
  async listFormats() {
    const context = RequestContextService.getContext();
    const storeId = context?.store_id;
    const orgId = context?.organization_id;

    if (!storeId || !orgId) {
      throw new VendixHttpException(ErrorCodes.ROLE_SCOPE_003);
    }

    const formats = await this.printFormatsService.listStoreFormats(storeId, orgId);
    return this.responseService.success(formats);
  }

  @Get(':formatType')
  @Permissions('store:settings:read', 'invoicing:read')
  // Misma razón que en `listFormats`: la factura precarga el detalle del
  // formato elegido (E.1) y necesita alcanzarlo con `invoicing:read`.
  @ApiOperation({ summary: 'Get print format configuration and template detail' })
  async getFormatDetail(@Param('formatType') formatType: print_format_type_enum) {
    const context = RequestContextService.getContext();
    const storeId = context?.store_id;

    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.ROLE_SCOPE_003);
    }

    const detail = await this.printFormatsService.getStoreFormatDetail(storeId, formatType);
    return this.responseService.success(detail);
  }

  @Put(':formatType')
  @Permissions('store:settings:update')
  @ApiOperation({ summary: 'Update print format configuration and overrides for store' })
  async updateFormat(
    @Param('formatType') formatType: print_format_type_enum,
    @Body() dto: UpdatePrintFormatConfigDto,
  ) {
    const context = RequestContextService.getContext();
    const storeId = context?.store_id;
    const orgId = context?.organization_id;

    if (!storeId || !orgId) {
      throw new VendixHttpException(ErrorCodes.ROLE_SCOPE_003);
    }

    const updated = await this.printFormatsService.updateStoreFormat(
      storeId,
      orgId,
      formatType,
      dto,
    );
    return this.responseService.success(updated, 'Formato de impresión actualizado correctamente.');
  }

  @Delete(':formatType')
  @Permissions('store:settings:update')
  @ApiOperation({ summary: 'Reset print format to system defaults' })
  async resetFormat(@Param('formatType') formatType: print_format_type_enum) {
    const context = RequestContextService.getContext();
    const storeId = context?.store_id;

    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.ROLE_SCOPE_003);
    }

    const result = await this.printFormatsService.resetStoreFormatToDefault(storeId, formatType);
    return this.responseService.success(result);
  }

  @Post(':formatType/preview')
  @Permissions('store:settings:read', 'invoicing:read')
  // Ampliado para E.2: la previsualización «cómo saldrá» se abre desde la
  // pantalla de creación de factura, que corre bajo `invoicing:read`. Sigue
  // siendo de sólo lectura: no persiste ni toma consecutivo.
  @ApiOperation({ summary: 'Generate live preview of print format with draft overrides' })
  async previewFormat(
    @Param('formatType') formatType: print_format_type_enum,
    @Body() dto: PrintPreviewRequestDto,
  ) {
    const context = RequestContextService.getContext();
    const storeId = context?.store_id;

    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.ROLE_SCOPE_003);
    }

    const preview = await this.gatewayService.preview(
      storeId,
      formatType,
      dto.overrides,
      dto.sample_document_id,
    );
    return this.responseService.success(preview);
  }

  @Post(':formatType/activate')
  @Permissions('store:settings:update')
  @ApiOperation({ summary: 'Activate print gateway for format type' })
  async activateGateway(@Param('formatType') formatType: print_format_type_enum) {
    const context = RequestContextService.getContext();
    const storeId = context?.store_id;
    const orgId = context?.organization_id;

    if (!storeId || !orgId) {
      throw new VendixHttpException(ErrorCodes.ROLE_SCOPE_003);
    }

    const result = await this.printFormatsService.activateGateway(storeId, orgId, formatType);
    return this.responseService.success(result, 'Print Gateway activado para este formato.');
  }

  @Post(':formatType/deactivate')
  @Permissions('store:settings:update')
  @ApiOperation({ summary: 'Deactivate print gateway for format type (fallback to legacy)' })
  async deactivateGateway(@Param('formatType') formatType: print_format_type_enum) {
    const context = RequestContextService.getContext();
    const storeId = context?.store_id;
    const orgId = context?.organization_id;

    if (!storeId || !orgId) {
      throw new VendixHttpException(ErrorCodes.ROLE_SCOPE_003);
    }

    const result = await this.printFormatsService.deactivateGateway(storeId, orgId, formatType);
    return this.responseService.success(result, 'Print Gateway desactivado (modo estándar activo).');
  }

  @Post('render')
  @Permissions('store:pos:access', 'store:orders:read', 'store:settings:read')
  @ApiOperation({ summary: 'Render a document via Print Gateway' })
  async renderDocument(@Body() dto: RenderPrintDocumentDto) {
    const context = RequestContextService.getContext();
    const storeId = context?.store_id;

    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.ROLE_SCOPE_003);
    }

    const result = await this.gatewayService.renderDocument(
      storeId,
      // CP-DTLP-20260827 (Phase B.4): PrintFormatTypeEnum (TS) incluye
      // dispatch_ticket, pero @prisma/client todavía no (se regenera tras
      // la migración + `prisma generate`). Cast explícito en la frontera
      // para que el undécimo formato atraviese el gateway sin romper tsc.
      dto.format_type as unknown as print_format_type_enum,
      dto.document_id,
      dto.engine,
    );
    return this.responseService.success(result);
  }

  /**
   * [print-editor-dsk P3.1] — Picker de documentos recientes del editor
   * del Hub. Devuelve los N documentos más recientes del formato
   * (default 20, cap 50) para alimentar el dropdown que reemplaza la
   * selección vacía → `getSampleData()` del preview.
   *
   * Permisos: `store:settings:read` (mismo que `getFormatDetail`) — el
   * editor ya exige ese permiso para abrir la pantalla, así que el
   * picker no abre superficie nueva.
   *
   * Store-id: tomado del contexto JWT, igual que el resto de endpoints
   * de este controlador. Esto cierra el vector que el IDOR H-1 ya
   * arregló para `render`: el picker nunca ve tiendas de otra org.
   */
  @Get(':formatType/documents')
  @Permissions('store:settings:read')
  @ApiOperation({ summary: 'List recent documents of a print format for the current store' })
  async getRecentDocuments(
    @Param('formatType') formatType: string,
    @Query('limit') limit?: string,
  ) {
    const context = RequestContextService.getContext();
    const storeId = context?.store_id;

    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.ROLE_SCOPE_003);
    }

    const requested = limit ? Number(limit) : 20;
    // Cap defensivo en el controller: si llega `?limit=99999`, el servicio
    // también capa a 50, pero el controller evita que el `Number()` se
    // convierta en NaN y se cuele al servicio.
    const safeLimit = Number.isFinite(requested) ? requested : 20;
    const data = await this.documentIndexService.listRecent(
      storeId,
      formatType,
      safeLimit,
    );
    return this.responseService.success(data);
  }
}
