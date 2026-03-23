import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ExogenousService } from './exogenous.service';
import { ResponseService } from '@common/responses/response.service';
import { GenerateReportDto, QueryReportsDto } from './dto';
import { Permissions } from '../../auth/decorators/permissions.decorator';

@Controller('store/exogenous')
export class ExogenousController {
  constructor(
    private readonly exogenous_service: ExogenousService,
    private readonly response_service: ResponseService,
  ) {}

  @Get('reports')
  @Permissions('exogenous:read')
  async findAll(@Query() query: QueryReportsDto) {
    const result = await this.exogenous_service.findAll(query);
    return this.response_service.paginated(result.data, result.meta.total, result.meta.page, result.meta.limit);
  }

  @Post('reports/generate')
  @Permissions('exogenous:write')
  async generateReport(@Body() dto: GenerateReportDto) {
    const result = await this.exogenous_service.generateReport(dto);
    return this.response_service.success(result, 'Report generated successfully');
  }

  @Get('reports/:id')
  @Permissions('exogenous:read')
  async findOne(@Param('id') id: string) {
    const result = await this.exogenous_service.findOne(+id);
    return this.response_service.success(result);
  }

  @Get('reports/:id/lines')
  @Permissions('exogenous:read')
  async getReportLines(
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const result = await this.exogenous_service.getReportLines(+id, +(page || 1), +(limit || 50));
    return this.response_service.paginated(result.data, result.meta.total, result.meta.page, result.meta.limit);
  }

  @Get('reports/:id/download')
  @Permissions('exogenous:read')
  async downloadReport(
    @Param('id') id: string,
    @Query('format') format?: string,
  ) {
    const result = await this.exogenous_service.downloadReport(+id, format || 'txt');
    return this.response_service.success(result, 'Download URL generated');
  }

  @Post('reports/:id/submit')
  @Permissions('exogenous:write')
  async markAsSubmitted(@Param('id') id: string) {
    const result = await this.exogenous_service.markAsSubmitted(+id);
    return this.response_service.success(result, 'Report marked as submitted');
  }

  @Get('validate/:year')
  @Permissions('exogenous:read')
  async validateYear(@Param('year') year: string) {
    const result = await this.exogenous_service.validateYear(+year);
    return this.response_service.success(result);
  }

  @Get('stats/:year')
  @Permissions('exogenous:read')
  async getStats(@Param('year') year: string) {
    const result = await this.exogenous_service.getStats(+year);
    return this.response_service.success(result);
  }
}
