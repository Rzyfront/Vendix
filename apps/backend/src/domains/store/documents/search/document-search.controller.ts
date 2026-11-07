import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { IndustryModuleGuard } from '../../../../common/guards/industry-module.guard';
import { IndustryModule } from '../../../../common/decorators/industry-module.decorator';
import {
  DocumentSearchQueryDto,
  FolderEntitiesQueryDto,
  FolderFilesQueryDto,
} from './document-search.dto';
import { DocumentSearchService } from './document-search.service';

/** Search and folders by entity. `store:documents:read` sees the whole store. */
@Controller('store/documents')
@UseGuards(PermissionsGuard, IndustryModuleGuard)
@IndustryModule('documents')
export class DocumentSearchController {
  constructor(
    private readonly search: DocumentSearchService,
    private readonly responseService: ResponseService,
  ) {}

  @Get('search')
  @Permissions('store:documents:read')
  async find(@Query() query: DocumentSearchQueryDto) {
    const r = await this.search.search(query);
    return this.responseService.paginated(r.data, r.total, r.page, r.limit);
  }

  @Get('folders')
  @Permissions('store:documents:read')
  async folders() {
    return this.responseService.success(await this.search.folders());
  }

  @Get('folders/:subjectType')
  @Permissions('store:documents:read')
  async entities(@Param('subjectType') subjectType: string, @Query() query: FolderEntitiesQueryDto) {
    const r = await this.search.folderEntities(subjectType, query);
    return this.responseService.paginated(r.data, r.total, r.page, r.limit);
  }

  @Get('folders/:subjectType/:subjectId')
  @Permissions('store:documents:read')
  async entityFiles(
    @Param('subjectType') subjectType: string,
    @Param('subjectId', ParseIntPipe) subjectId: number,
    @Query() query: FolderFilesQueryDto,
  ) {
    const r = await this.search.folderFiles(subjectType, subjectId, query);
    return this.responseService.success(r);
  }
}
