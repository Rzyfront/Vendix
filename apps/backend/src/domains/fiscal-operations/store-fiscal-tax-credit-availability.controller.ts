import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { ResponseService } from '@common/responses/response.service';
import { FiscalContextResolverService } from './services/fiscal-context-resolver.service';
import { FiscalTaxCreditAvailabilityService } from './services/fiscal-tax-credit-availability.service';
import { FiscalTaxCreditAvailabilityQueryDto, parseFiscalAsOfDate } from './dto/fiscal-tax-credit-availability.dto';

@Controller('store/fiscal')
@UseGuards(PermissionsGuard)
export class StoreFiscalTaxCreditAvailabilityController {
  constructor(
    private readonly contextResolver: FiscalContextResolverService,
    private readonly availability: FiscalTaxCreditAvailabilityService,
    private readonly response: ResponseService,
  ) {}

  @Get('tax-credits/availability')
  @Permissions('store:fiscal:dashboard:read')
  async getAvailability(@Query() query: FiscalTaxCreditAvailabilityQueryDto) {
    if (query.store_id !== undefined) {
      throw new BadRequestException('store_id cannot be selected from the store fiscal context');
    }
    const context = await this.contextResolver.resolveForStore();
    return this.response.success(await this.availability.list(
      context,
      query.tax_type,
      query.jurisdiction_key,
      parseFiscalAsOfDate(query.as_of),
    ));
  }
}
