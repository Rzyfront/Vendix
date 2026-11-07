import { Body, Controller, Get, Param, ParseIntPipe, Patch, Put, UseGuards } from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { IndustryModuleGuard } from '../../../../common/guards/industry-module.guard';
import { IndustryModule } from '../../../../common/decorators/industry-module.decorator';
import { SetLegalHoldDto, UpdateFileProfileDto } from './document-file-profiles.dto';
import { DocumentFileProfilesService } from './document-file-profiles.service';

/** Type, tags, expiry and legal hold of a stored file (P4.6/P4.4). */
@Controller('store/documents/files')
@UseGuards(PermissionsGuard, IndustryModuleGuard)
@IndustryModule('documents')
export class DocumentFileProfilesController {
  constructor(
    private readonly profiles: DocumentFileProfilesService,
    private readonly responseService: ResponseService,
  ) {}

  @Get(':id/profile')
  @Permissions('store:documents:read')
  async get(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.success(await this.profiles.get(id));
  }

  @Patch(':id/profile')
  @Permissions('store:workflows:manage')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateFileProfileDto) {
    return this.responseService.success(await this.profiles.update(id, dto));
  }

  @Put(':id/legal-hold')
  @Permissions('store:workflows:manage')
  async legalHold(@Param('id', ParseIntPipe) id: number, @Body() dto: SetLegalHoldDto) {
    return this.responseService.success(await this.profiles.setLegalHold(id, dto.legal_hold));
  }
}
