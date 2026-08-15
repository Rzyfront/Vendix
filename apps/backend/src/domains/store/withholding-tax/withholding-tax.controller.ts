import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { WithholdingTaxService } from './withholding-tax.service';
import { ResponseService } from '@common/responses/response.service';
import {
  CreateWithholdingConceptDto,
  UpdateWithholdingConceptDto,
  CalculateWithholdingDto,
  CreateUvtValueDto,
  PreviewWithholdingDto,
  CalculationsQueryDto,
} from './dto';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

/**
 * Año gravable de un certificado, resuelto desde el query `?year=`.
 *
 * Se resuelve aquí y no con `ParseIntPipe` porque el contrato de estas rutas es
 * «sin `year` explícito, el año en curso», y el pipe no distingue el parámetro
 * ausente del vacío. Lo que sí hace falta es cortar el texto que no es un año:
 * `?year=abc` se convertía en `NaN`, llegaba a `new Date(Date.UTC(NaN, 0, 1))`
 * y Prisma reventaba con un 500 sobre una fecha inválida.
 */
const CERTIFICATE_MIN_YEAR = 2000;
const CERTIFICATE_MAX_YEAR = 2100;

function resolveCertificateYear(raw?: string): number {
  if (raw === undefined || raw === null || raw.trim() === '') {
    return new Date().getFullYear();
  }

  const parsed = Number(raw);
  if (
    !Number.isInteger(parsed) ||
    parsed < CERTIFICATE_MIN_YEAR ||
    parsed > CERTIFICATE_MAX_YEAR
  ) {
    throw new VendixHttpException(
      ErrorCodes.WHT_CALCULATION_ERROR,
      `year debe ser un año gravable de 4 dígitos entre ${CERTIFICATE_MIN_YEAR} y ${CERTIFICATE_MAX_YEAR}.`,
    );
  }

  return parsed;
}

@Controller('store/withholding-tax')
export class WithholdingTaxController {
  constructor(
    private readonly withholding_tax_service: WithholdingTaxService,
    private readonly response_service: ResponseService,
  ) {}

  // ===== Concepts =====

  @Get('concepts')
  @Permissions('withholding:read')
  async findAllConcepts() {
    const result = await this.withholding_tax_service.findAllConcepts();
    return this.response_service.success(result);
  }

  @Post('concepts')
  @Permissions('withholding:write')
  async createConcept(@Body() dto: CreateWithholdingConceptDto) {
    const result = await this.withholding_tax_service.createConcept(dto);
    return this.response_service.success(
      result,
      'Withholding concept created successfully',
    );
  }

  /**
   * `ParseIntPipe` en todos los identificadores de ruta de este controlador, la
   * misma forma que usa `DianConfigController`. Sin él, `+id` sobre un texto no
   * numérico producía `NaN` y Prisma lo rechazaba contra la columna `Int` con un
   * 500: la petición está mal formada, el servidor no falló. Con un id numérico
   * inexistente la respuesta ya era el 404 correcto, así que lo único que
   * faltaba era la puerta de entrada.
   */
  @Put('concepts/:id')
  @Permissions('withholding:write')
  async updateConcept(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateWithholdingConceptDto,
  ) {
    const result = await this.withholding_tax_service.updateConcept(id, dto);
    return this.response_service.success(
      result,
      'Withholding concept updated successfully',
    );
  }

  @Delete('concepts/:id')
  @Permissions('withholding:delete')
  async deactivateConcept(@Param('id', ParseIntPipe) id: number) {
    const result = await this.withholding_tax_service.deactivateConcept(id);
    return this.response_service.success(
      result,
      'Withholding concept deactivated successfully',
    );
  }

  // ===== UVT Values =====

  @Get('uvt-values')
  @Permissions('withholding:read')
  async findAllUvt() {
    const result = await this.withholding_tax_service.findAllUvt();
    return this.response_service.success(result);
  }

  @Post('uvt-values')
  @Permissions('withholding:write')
  async createUvt(@Body() dto: CreateUvtValueDto) {
    const result = await this.withholding_tax_service.createUvt(dto);
    return this.response_service.success(
      result,
      'UVT value saved successfully',
    );
  }

  // ===== Calculate =====

  @Post('calculate')
  @Permissions('withholding:read')
  async calculateWithholding(@Body() dto: CalculateWithholdingDto) {
    const result = await this.withholding_tax_service.calculateWithholding(
      dto.amount,
      dto.concept_code,
      dto.supplier_type,
    );
    return this.response_service.success(result);
  }

  // ===== Preview (no persistence) =====

  @Post('preview')
  @Permissions('withholding:read')
  async previewWithholding(@Body() dto: PreviewWithholdingDto) {
    const result = await this.withholding_tax_service.previewWithholding(dto);
    return this.response_service.success(result);
  }

  // ===== Apply to Invoice =====

  @Post('apply/:invoiceId')
  @Permissions('withholding:write')
  async applyWithholding(
    @Param('invoiceId', ParseIntPipe) invoice_id: number,
    @Body() body: { concept_code: string; supplier_type?: string },
  ) {
    const result = await this.withholding_tax_service.applyWithholding(
      invoice_id,
      body.concept_code,
      body.supplier_type,
    );
    return this.response_service.success(result);
  }

  // ===== Calculations Audit =====

  @Get('calculations')
  @Permissions('withholding:read')
  async findAllCalculations(@Query() query: CalculationsQueryDto) {
    const result =
      await this.withholding_tax_service.findAllCalculations(query);
    return this.response_service.paginated(
      result.data,
      result.total,
      result.page,
      result.limit,
    );
  }

  // ===== Certificates =====
  // NOTE: literal sub-paths (`employee/:id`, `suffered/:type/:id`) MUST be
  // declared before the generic `:supplierId` route below — Nest matches
  // routes in declaration order and would otherwise treat "employee"/
  // "suffered" as a numeric supplierId param.

  /**
   * Certificado de Ingresos y Retenciones (Formulario 220 DIAN) por empleado
   * y año gravable: salarios, aportes salud/pensión y retefuente laboral
   * total del año (deductions.retention, segregada a 236505 desde B1).
   */
  @Get('certificates/employee/:employeeId')
  @Permissions('withholding:read')
  async generateEmployeeCertificate(
    @Param('employeeId', ParseIntPipe) employee_id: number,
    @Query('year') year?: string,
  ) {
    const certificate_year = resolveCertificateYear(year);
    const result =
      await this.withholding_tax_service.generateEmployeeCertificate(
        employee_id,
        certificate_year,
      );
    return this.response_service.success(result);
  }

  /**
   * Certificado de retención "sufrida": desglose de las retenciones que un
   * customer o supplier (actuando como agente retenedor) le practicó al
   * tenant en un año gravable (role='suffered').
   */
  @Get('certificates/suffered/:counterpartyType/:counterpartyId')
  @Permissions('withholding:read')
  async generateSufferedCertificate(
    // `counterpartyType` NO lleva `ParseIntPipe`: es un discriminante de texto
    // ("customer" | "supplier"), y su validación es la guarda de abajo.
    @Param('counterpartyType') counterparty_type: string,
    @Param('counterpartyId', ParseIntPipe) counterparty_id: number,
    @Query('year') year?: string,
  ) {
    if (counterparty_type !== 'customer' && counterparty_type !== 'supplier') {
      throw new VendixHttpException(
        ErrorCodes.WHT_CALCULATION_ERROR,
        'counterpartyType must be "customer" or "supplier"',
      );
    }
    const certificate_year = resolveCertificateYear(year);
    const result =
      await this.withholding_tax_service.generateSufferedCertificate(
        counterparty_type,
        counterparty_id,
        certificate_year,
      );
    return this.response_service.success(result);
  }

  @Get('certificates/:supplierId')
  @Permissions('withholding:read')
  async generateCertificate(
    @Param('supplierId', ParseIntPipe) supplier_id: number,
    @Query('year') year?: string,
  ) {
    const certificate_year = resolveCertificateYear(year);
    const result = await this.withholding_tax_service.generateCertificate(
      supplier_id,
      certificate_year,
    );
    return this.response_service.success(result);
  }

  // ===== Stats =====

  @Get('stats')
  @Permissions('withholding:read')
  async getStats() {
    const result = await this.withholding_tax_service.getStats();
    return this.response_service.success(result);
  }
}
