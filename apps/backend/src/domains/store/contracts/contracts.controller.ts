import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ContractsService, ContractStatus } from './contracts.service';
import { InvoicingService } from '../invoicing/invoicing.service';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { ConstructionIndustryGuard } from '../../../common/guards/construction-industry.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';

const CONTRACT_STATUSES = ['draft', 'active', 'invoiced', 'cancelled'];

/**
 * C.2 (FB-07) — filtros del listado. DTO inline a proposito: el alcance
 * del step solo admite `contracts.controller.ts` / `contracts.service.ts`
 * (+spec), sin nuevos archivos `dto/`.
 */
class ContractQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  @IsIn([...CONTRACT_STATUSES])
  status?: ContractStatus;
}

/** C.2 (FB-07, ERR-06) — la transicion ilegal la rechaza el servicio (422). */
class UpdateContractStatusDto {
  @IsString()
  @IsIn([...CONTRACT_STATUSES])
  status!: ContractStatus;
}

/**
 * C.1 (FB-06) — `POST /store/contracts/from-quotation/:id` crea la ficha
 * del contrato desde la cotizacion aceptada. El gating por industria
 * (A.2, ERR-03) es frontera real: sin `construction` responde 403 aunque
 * se invoque por fuera del menu. Los permisos `store:contracts:*` ya
 * existen en el seed (A.2).
 *
 * C.2 (FB-07, ERR-06) — lectura y transiciones de la ficha: las rutas
 * estaticas van antes de `:id` para que nunca las capture el parametro.
 */
@Controller('store/contracts')
@UseGuards(PermissionsGuard, ConstructionIndustryGuard)
export class ContractsController {
  constructor(
    private readonly contractsService: ContractsService,
    private readonly invoicingService: InvoicingService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:contracts:read')
  async findAll(@Query() query: ContractQueryDto) {
    const result = await this.contractsService.findAll(query);
    return this.responseService.success(
      result,
      'Contratos obtenidos exitosamente',
    );
  }

  @Post('from-quotation/:id')
  @Permissions('store:contracts:create')
  async createFromQuotation(@Param('id', ParseIntPipe) id: number) {
    const result = await this.contractsService.createFromQuotation(id);
    return this.responseService.created(
      result,
      'Contrato creado exitosamente',
    );
  }

  @Get(':id')
  @Permissions('store:contracts:read:one')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const result = await this.contractsService.findOne(id);
    return this.responseService.success(
      result,
      'Contrato obtenido exitosamente',
    );
  }

  @Patch(':id')
  @Permissions('store:contracts:update')
  async updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateContractStatusDto,
  ) {
    const result = await this.contractsService.updateStatus(id, dto.status);
    return this.responseService.updated(
      result,
      'Estado del contrato actualizado exitosamente',
    );
  }

  /**
   * D.2 (FB-08, ERR-07) — `POST /store/contracts/:id/invoice` genera el
   * borrador de factura AIU precargada desde un contrato VIGENTE (`active`),
   * delegando en `InvoicingService.createInvoiceFromContract` (D.1: atomico
   * factura `draft` + contrato a `invoiced`, triple-capa de idempotencia).
   *
   * Permiso `invoicing:write` (facturar, seed existente — sin permiso nuevo):
   * paridad con `POST /store/invoicing/from-order/:orderId`, que tambien
   * factura desde un documento origen. El gating por industria `construction`
   * (403 ERR-03) lo hereda del guard de clase, igual que `from-quotation`.
   *
   * Sin `try/catch` a proposito: el duplicado viaja como 409
   * `CONTRACT_INVOICE_001` (con `invoice_id` para navegar a la factura), el
   * no-`active` como 422 `CONTRACT_STATUS_001` y el inexistente como 404 —
   * `AllExceptionsFilter` los emite con su status real solo si la excepcion
   * sale del handler.
   */
  @Post(':id/invoice')
  @Permissions('invoicing:write')
  async createInvoiceFromContract(@Param('id', ParseIntPipe) id: number) {
    const result =
      await this.invoicingService.createInvoiceFromContract(id);
    return this.responseService.created(result, 'Factura creada exitosamente');
  }
}
