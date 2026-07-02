import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { WithholdingTaxService } from './withholding-tax.service';
import { ResponseService } from '@common/responses/response.service';
import {
  CreateWithholdingConceptDto,
  UpdateWithholdingConceptDto,
  CalculateWithholdingDto,
  PreviewWithholdingDto,
  CalculationsQueryDto,
} from './dto';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

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

  @Put('concepts/:id')
  @Permissions('withholding:write')
  async updateConcept(
    @Param('id') id: string,
    @Body() dto: UpdateWithholdingConceptDto,
  ) {
    const result = await this.withholding_tax_service.updateConcept(+id, dto);
    return this.response_service.success(
      result,
      'Withholding concept updated successfully',
    );
  }

  @Delete('concepts/:id')
  @Permissions('withholding:delete')
  async deactivateConcept(@Param('id') id: string) {
    const result = await this.withholding_tax_service.deactivateConcept(+id);
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
  async createUvt(@Body() body: { year: number; value_cop: number }) {
    const result = await this.withholding_tax_service.createUvt(body);
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
    @Param('invoiceId') invoice_id: string,
    @Body() body: { concept_code: string; supplier_type?: string },
  ) {
    const result = await this.withholding_tax_service.applyWithholding(
      +invoice_id,
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
    @Param('employeeId') employee_id: string,
    @Query('year') year: string,
  ) {
    const certificate_year = year ? +year : new Date().getFullYear();
    const result =
      await this.withholding_tax_service.generateEmployeeCertificate(
        +employee_id,
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
    @Param('counterpartyType') counterparty_type: string,
    @Param('counterpartyId') counterparty_id: string,
    @Query('year') year: string,
  ) {
    if (counterparty_type !== 'customer' && counterparty_type !== 'supplier') {
      throw new VendixHttpException(
        ErrorCodes.WHT_CALCULATION_ERROR,
        'counterpartyType must be "customer" or "supplier"',
      );
    }
    const certificate_year = year ? +year : new Date().getFullYear();
    const result =
      await this.withholding_tax_service.generateSufferedCertificate(
        counterparty_type,
        +counterparty_id,
        certificate_year,
      );
    return this.response_service.success(result);
  }

  @Get('certificates/:supplierId')
  @Permissions('withholding:read')
  async generateCertificate(
    @Param('supplierId') supplier_id: string,
    @Query('year') year: string,
  ) {
    const certificate_year = year ? +year : new Date().getFullYear();
    const result = await this.withholding_tax_service.generateCertificate(
      +supplier_id,
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
