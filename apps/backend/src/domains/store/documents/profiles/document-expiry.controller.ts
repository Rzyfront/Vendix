import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { IndustryModuleGuard } from '../../../../common/guards/industry-module.guard';
import { IndustryModule } from '../../../../common/decorators/industry-module.decorator';
import { DocumentExpiryService } from './document-expiry.service';

export class ExpiringQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365) days?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number = 20;
}

/** "Por vencer": files close to (or past) their expiry date. */
@Controller('store/documents/expiring')
@UseGuards(PermissionsGuard, IndustryModuleGuard)
@IndustryModule('documents')
export class DocumentExpiryController {
  constructor(
    private readonly expiry: DocumentExpiryService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:documents:read')
  async list(@Query() query: ExpiringQueryDto) {
    const r = await this.expiry.listExpiring(query);
    return this.responseService.paginated(r.data, r.total, r.page, r.limit);
  }
}
