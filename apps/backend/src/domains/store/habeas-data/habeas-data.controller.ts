import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  Param,
  Ip,
  Headers,
  Query,
} from '@nestjs/common';
import { HabeasDataService } from './habeas-data.service';
import { ResponseService } from '@common/responses/response.service';
import { UpdateConsentsDto } from './dto/update-consents.dto';
import { RequestAnonymizationDto } from './dto/request-anonymization.dto';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { RequestContextService } from '@common/context/request-context.service';

@Controller('store/habeas-data')
export class HabeasDataController {
  constructor(
    private readonly habeas_data_service: HabeasDataService,
    private readonly response_service: ResponseService,
  ) {}

  @Get('stats')
  @Permissions('habeas-data:read-consents')
  async getStats() {
    const result = await this.habeas_data_service.getStats();
    return this.response_service.success(result);
  }

  @Get('users/search')
  @Permissions('habeas-data:anonymize')
  async searchUsers(@Query('q') query: string) {
    const result = await this.habeas_data_service.searchUsers(query);
    return this.response_service.success(result);
  }

  @Get('users/:id/consents')
  @Permissions('habeas-data:read-consents')
  async getUserConsents(@Param('id') id: string) {
    const result = await this.habeas_data_service.getUserConsents(+id);
    return this.response_service.success(result);
  }

  @Patch('users/:id/consents')
  @Permissions('habeas-data:update-consents')
  async updateConsents(
    @Param('id') id: string,
    @Body() dto: UpdateConsentsDto,
    @Ip() ip: string,
    @Headers('user-agent') user_agent: string,
  ) {
    const result = await this.habeas_data_service.updateConsents(
      +id,
      dto.consents,
      ip,
      user_agent,
    );
    return this.response_service.success(result, 'Consents updated successfully');
  }

  @Post('users/:id/data-export')
  @Permissions('habeas-data:export-data')
  async requestDataExport(@Param('id') id: string) {
    const result = await this.habeas_data_service.requestDataExport(+id);
    return this.response_service.success(result, 'Data export request created');
  }

  @Get('my-exports')
  @Permissions('habeas-data:export-data')
  async getMyExports() {
    const context = RequestContextService.getContext();
    const user_id = context?.user_id || 0;
    const result = await this.habeas_data_service.getUserExportRequests(user_id);
    return this.response_service.success(result);
  }

  @Get('data-exports/:requestId')
  @Permissions('habeas-data:export-data')
  async getExportStatus(@Param('requestId') request_id: string) {
    const context = RequestContextService.getContext();
    const user_id = context?.user_id || 0;
    const result = await this.habeas_data_service.getExportStatus(+request_id, user_id);
    return this.response_service.success(result);
  }

  @Get('exports/:id/download')
  @Permissions('habeas-data:export-data')
  async getExportDownloadUrl(@Param('id') id: string) {
    const context = RequestContextService.getContext();
    const user_id = context?.user_id || 0;
    const result = await this.habeas_data_service.getExportDownloadUrl(+id, user_id);
    return this.response_service.success(result);
  }

  @Post('users/:id/anonymize')
  @Permissions('habeas-data:anonymize')
  async requestAnonymization(
    @Param('id') id: string,
    @Body() dto: RequestAnonymizationDto,
  ) {
    const context = RequestContextService.getContext();
    const admin_user_id = context?.user_id || 0;
    const result = await this.habeas_data_service.requestAnonymization(
      +id,
      admin_user_id,
      dto.reason,
    );
    return this.response_service.success(result, 'Anonymization request created');
  }

  @Post('anonymize/:requestId/confirm')
  @Permissions('habeas-data:anonymize')
  async executeAnonymization(@Param('requestId') request_id: string) {
    const context = RequestContextService.getContext();
    const admin_user_id = context?.user_id || 0;
    const result = await this.habeas_data_service.executeAnonymization(
      +request_id,
      admin_user_id,
    );
    return this.response_service.success(result, 'Anonymization executed successfully');
  }
}
