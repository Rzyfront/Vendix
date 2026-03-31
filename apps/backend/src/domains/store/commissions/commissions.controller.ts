import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { ResponseService } from '../../../common/responses/response.service';
import { CommissionsService } from './commissions.service';
import { CreateCommissionRuleDto } from './dto/create-commission-rule.dto';
import { UpdateCommissionRuleDto } from './dto/update-commission-rule.dto';
import {
  CommissionRuleQueryDto,
  CommissionCalculationQueryDto,
} from './dto/commission-query.dto';

@ApiTags('Commissions')
@Controller('store/commissions')
@UseGuards(PermissionsGuard)
export class CommissionsController {
  constructor(
    private readonly commissions_service: CommissionsService,
    private readonly response_service: ResponseService,
  ) {}

  // ─── LIST RULES ────────────────────────────────────────────
  @Get('rules')
  @Permissions('store:commissions:read')
  async findAllRules(@Query() query: CommissionRuleQueryDto) {
    const result = await this.commissions_service.findAllRules(query);
    return this.response_service.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
    );
  }

  // --- Static Routes (MUST be before :id) ---

  // ─── CALCULATIONS HISTORY ──────────────────────────────────
  @Get('calculations')
  @Permissions('store:commissions:read')
  async getCalculations(@Query() query: CommissionCalculationQueryDto) {
    const result = await this.commissions_service.getCalculations(query);
    return this.response_service.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
    );
  }

  // ─── REPORT ────────────────────────────────────────────────
  @Get('report')
  @Permissions('store:commissions:read')
  async getCommissionReport() {
    const result = await this.commissions_service.getCommissionReport();
    return this.response_service.success(
      result,
      'Reporte de comisiones obtenido',
    );
  }

  // --- Parameter Routes (MUST be last) ---

  // ─── RULE DETAIL ───────────────────────────────────────────
  @Get('rules/:id')
  @Permissions('store:commissions:read')
  async findOneRule(@Param('id') id: string) {
    const result = await this.commissions_service.findOneRule(+id);
    return this.response_service.success(result);
  }

  // ─── CREATE RULE ───────────────────────────────────────────
  @Post('rules')
  @Permissions('store:commissions:manage')
  async createRule(@Body() dto: CreateCommissionRuleDto) {
    const result = await this.commissions_service.createRule(dto);
    return this.response_service.success(
      result,
      'Regla de comisión creada exitosamente',
    );
  }

  // ─── UPDATE RULE ───────────────────────────────────────────
  @Put('rules/:id')
  @Permissions('store:commissions:manage')
  async updateRule(
    @Param('id') id: string,
    @Body() dto: UpdateCommissionRuleDto,
  ) {
    const result = await this.commissions_service.updateRule(+id, dto);
    return this.response_service.success(
      result,
      'Regla de comisión actualizada exitosamente',
    );
  }

  // ─── DELETE RULE (SOFT) ────────────────────────────────────
  @Delete('rules/:id')
  @Permissions('store:commissions:manage')
  async deleteRule(@Param('id') id: string) {
    const result = await this.commissions_service.deleteRule(+id);
    return this.response_service.success(
      result,
      'Regla de comisión desactivada exitosamente',
    );
  }
}
