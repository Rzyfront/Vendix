import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AccountMappingService } from './account-mapping.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { UpsertAccountMappingDto, ResetAccountMappingDto } from './dto/upsert-account-mapping.dto';
import { RequestContextService } from '../../../../common/context/request-context.service';

@Controller('store/accounting/account-mappings')
export class AccountMappingController {
  constructor(
    private readonly account_mapping_service: AccountMappingService,
    private readonly response_service: ResponseService,
  ) {}

  private getContext() {
    const context = RequestContextService.getContext();
    if (!context) {
      throw new Error('No request context found');
    }
    return context;
  }

  @Get()
  async getMappings(
    @Query('prefix') prefix?: string,
    @Query('store_id') store_id?: string,
  ) {
    const context = this.getContext();
    const parsed_store_id = store_id ? +store_id : undefined;

    const result = await this.account_mapping_service.getMappings(
      context.organization_id!,
      prefix,
      parsed_store_id,
    );
    return this.response_service.success(result);
  }

  @Put()
  async bulkUpsertMappings(@Body() dto: UpsertAccountMappingDto) {
    const context = this.getContext();

    const result = await this.account_mapping_service.bulkUpsertMappings(
      context.organization_id!,
      dto.mappings,
      dto.store_id,
    );
    return this.response_service.success(result, 'Mappings updated successfully');
  }

  @Post('reset')
  @HttpCode(HttpStatus.OK)
  async resetToDefaults(@Body() dto: ResetAccountMappingDto) {
    const context = this.getContext();

    await this.account_mapping_service.resetToDefaults(
      context.organization_id!,
      dto.store_id,
    );
    return this.response_service.success(null, 'Mappings reset to defaults');
  }
}
