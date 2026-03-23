import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IcaService } from './ica.service';
import {
  IcaRatesQueryDto,
  IcaCalculateDto,
  IcaReportQueryDto,
} from './dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';

@Controller('store/taxes/ica')
@UseGuards(PermissionsGuard)
export class IcaController {
  constructor(
    private readonly ica_service: IcaService,
    private readonly response_service: ResponseService,
  ) {}

  @Get('rates')
  @Permissions('taxes:ica:read')
  async findAllRates(@Query() query: IcaRatesQueryDto) {
    try {
      const result = await this.ica_service.findAllRates(query);
      return this.response_service.paginated(
        result.data,
        result.meta.total,
        result.meta.page,
        result.meta.limit,
        'Tarifas ICA obtenidas exitosamente',
      );
    } catch (error) {
      throw error;
    }
  }

  @Get('resolve')
  @Permissions('taxes:ica:read')
  async resolveStoreRate() {
    try {
      const result = await this.ica_service.resolveStoreIcaRate();
      return this.response_service.success(
        result,
        'Tarifa ICA de la tienda resuelta exitosamente',
      );
    } catch (error) {
      throw error;
    }
  }

  @Post('calculate')
  @Permissions('taxes:ica:read')
  async calculateICA(@Body() dto: IcaCalculateDto) {
    try {
      const result = await this.ica_service.calculateICA(
        dto.amount,
        dto.municipality_code,
        dto.ciiu_code,
      );
      return this.response_service.success(
        result,
        'ICA calculado exitosamente',
      );
    } catch (error) {
      throw error;
    }
  }

  @Get('report')
  @Permissions('taxes:ica:report')
  async getIcaReport(@Query() query: IcaReportQueryDto) {
    try {
      const result = await this.ica_service.getIcaReport(query.period);
      return this.response_service.success(
        result,
        'Reporte ICA generado exitosamente',
      );
    } catch (error) {
      throw error;
    }
  }
}
