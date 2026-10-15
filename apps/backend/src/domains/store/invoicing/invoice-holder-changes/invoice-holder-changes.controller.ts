import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  ParseIntPipe,
  UseGuards,
  Res,
  Req,
} from '@nestjs/common';
import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
  IsArray,
  ArrayMaxSize,
  IsEnum,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import { tax_regime_enum } from '@prisma/client';
import { FISCAL_RESPONSIBILITIES } from '../../../../common/constants/fiscal-responsibilities';
import { Response } from 'express';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import {
  ModuleFlowGuard,
  RequireModuleFlow,
} from '../../../../common/guards/module-flow.guard';
import { SkipSubscriptionGate } from '../../subscriptions/decorators/skip-subscription-gate.decorator';
import { InvoiceHolderChangesService } from './invoice-holder-changes.service';
import { SubmitInvoiceDataDto } from '../invoice-data-requests/dto/submit-invoice-data.dto';

export class HolderChangeReasonDto {
  @IsString() @MinLength(5) @MaxLength(500) reason!: string;
}
export class HolderChangeSnapshotDto extends SubmitInvoiceDataDto {
  @IsOptional() @IsEnum(tax_regime_enum) tax_regime?: tax_regime_enum;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsIn(FISCAL_RESPONSIBILITIES, { each: true })
  fiscal_responsibilities?: string[];
}
export class HolderChangeCustomerDto {
  @IsOptional() @IsInt() @Min(1) customer_id?: number;
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => HolderChangeSnapshotDto)
  snapshot?: HolderChangeSnapshotDto;
}

@Controller('store/invoicing')
@UseGuards(ModuleFlowGuard, PermissionsGuard)
@RequireModuleFlow('invoicing')
export class InvoiceHolderChangesController {
  constructor(private readonly changes: InvoiceHolderChangesService) {}
  private result(res: Response, value: { run_status: string }) {
    return res
      .status(value.run_status === 'completed' ? 200 : 202)
      .json({ success: true, data: value });
  }
  @Get('holder-changes/:operationId')
  @Permissions('invoicing:read')
  async status(@Param('operationId', ParseIntPipe) id: number) {
    return { success: true, data: await this.changes.getOperation(id) };
  }
  // Existing irreversible operations remain resumable when admission or subscription is disabled.
  @Post('holder-changes/:operationId/customer')
  @Permissions('invoicing:write')
  @SkipSubscriptionGate()
  async customer(
    @Param('operationId', ParseIntPipe) id: number,
    @Body() body: HolderChangeCustomerDto,
    @Req()
    req: {
      user?: {
        roles?: string[];
        permissions?: Array<{ name: string; status: string }>;
      };
    },
  ) {
    const user = req.user;
    const required = body.customer_id
      ? ['store:customers:read']
      : ['store:customers:create'];
    if (
      !user?.roles?.includes('super_admin') &&
      !user?.permissions?.some(
        (p) => p.status === 'active' && required.includes(p.name),
      )
    )
      throw new VendixHttpException(ErrorCodes.AUTH_PERM_001);
    return {
      success: true,
      data: await this.changes.setCustomer(id, body.customer_id, body.snapshot),
    };
  }
  @Post('holder-changes/:operationId/resume')
  @Permissions('invoicing:write')
  @SkipSubscriptionGate()
  async resume(
    @Param('operationId', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    return this.result(res, await this.changes.resume(id, true));
  }
  @Get(':id/holder-change-context')
  @Permissions('invoicing:read')
  async context(@Param('id', ParseIntPipe) id: number) {
    return { success: true, data: await this.changes.getContext(id) };
  }
  @Post(':id/release-order')
  @Permissions('invoicing:write')
  async release(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: HolderChangeReasonDto,
    @Res() res: Response,
  ) {
    return this.result(
      res,
      await this.changes.startManual(id, body.reason, 'release_only'),
    );
  }
  @Post(':id/remake')
  @Permissions('invoicing:write')
  async remake(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: HolderChangeReasonDto,
    @Res() res: Response,
  ) {
    return this.result(res, await this.changes.startManual(id, body.reason));
  }
}
