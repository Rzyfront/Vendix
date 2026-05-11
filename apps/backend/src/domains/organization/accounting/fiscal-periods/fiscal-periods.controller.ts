import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';

import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import {
  ModuleFlowGuard,
  RequireModuleFlow,
  SkipModuleFlowGuard,
} from '../../../../common/guards/module-flow.guard';
import { ResponseService } from '../../../../common/responses/response.service';

import { OrgFiscalPeriodsService } from './fiscal-periods.service';
import { CreateFiscalPeriodDto } from '../../../store/accounting/fiscal-periods/dto/create-fiscal-period.dto';
import { UpdateFiscalPeriodDto } from '../../../store/accounting/fiscal-periods/dto/update-fiscal-period.dto';

/**
 * Org-native fiscal periods controller. Optional `?store_id` query selects
 * a specific store's fiscal periods (mandatory under operating_scope=STORE
 * with multiple stores).
 */
@Controller('organization/accounting/fiscal-periods')
@UseGuards(ModuleFlowGuard, PermissionsGuard)
@RequireModuleFlow('accounting')
export class OrgFiscalPeriodsController {
  constructor(
    private readonly fiscalPeriods: OrgFiscalPeriodsService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @SkipModuleFlowGuard() // bootstrap: wizard loadInitial() lists fiscal periods while module still WIP
  @Permissions('organization:accounting:fiscal_periods:read')
  async findAll(@Query('store_id') storeIdRaw?: string) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.fiscalPeriods.findAll(store_id);
    return this.responseService.success(result);
  }

  @Get(':id')
  @Permissions('organization:accounting:fiscal_periods:read')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @Query('store_id') storeIdRaw?: string,
  ) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.fiscalPeriods.findOne(id, store_id);
    return this.responseService.success(result);
  }

  @Post()
  @SkipModuleFlowGuard() // bootstrap: wizard creates the initial fiscal period to satisfy ACTIVE requirements
  @Permissions('organization:accounting:fiscal_periods:create')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateFiscalPeriodDto,
    @Query('store_id') storeIdRaw?: string,
  ) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.fiscalPeriods.create(dto, store_id);
    return this.responseService.success(
      result,
      'Fiscal period created successfully',
    );
  }

  @Put(':id')
  @Permissions('organization:accounting:fiscal_periods:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateFiscalPeriodDto,
    @Query('store_id') storeIdRaw?: string,
  ) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.fiscalPeriods.update(id, dto, store_id);
    return this.responseService.success(
      result,
      'Fiscal period updated successfully',
    );
  }

  @Patch(':id/close')
  @Permissions('organization:accounting:fiscal_periods:update')
  @HttpCode(HttpStatus.OK)
  async close(
    @Param('id', ParseIntPipe) id: number,
    @Query('store_id') storeIdRaw?: string,
  ) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    const result = await this.fiscalPeriods.close(id, store_id);
    return this.responseService.success(
      result,
      'Fiscal period closed successfully',
    );
  }

  @Delete(':id')
  @Permissions('organization:accounting:fiscal_periods:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @Query('store_id') storeIdRaw?: string,
  ) {
    const store_id = storeIdRaw ? +storeIdRaw : undefined;
    await this.fiscalPeriods.remove(id, store_id);
    return this.responseService.success(
      null,
      'Fiscal period deleted successfully',
    );
  }
}
