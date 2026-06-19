import {
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { ResponseService } from '../../../common/responses/response.service';
import { WeeklyReportService } from './weekly-report.service';

@Controller('store/weekly-report')
@UseGuards(PermissionsGuard)
export class WeeklyReportController {
  constructor(
    private readonly service: WeeklyReportService,
    private readonly response_service: ResponseService,
  ) {}

  @Get('latest')
  @Permissions('store:weekly_report:read')
  async getLatest() {
    const result = await this.service.getLatestForCurrentStore();
    return this.response_service.success(result);
  }

  @Post(':id/viewed')
  @Permissions('store:weekly_report:read')
  async markViewed(@Param('id', ParseIntPipe) id: number) {
    const result = await this.service.markViewed(id);
    return this.response_service.success(result, 'Weekly report marked as viewed');
  }
}
