import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { IndustryModuleGuard } from '../../../../common/guards/industry-module.guard';
import { IndustryModule } from '../../../../common/decorators/industry-module.decorator';
import {
  CreateRetentionPolicyDto,
  PageQueryDto,
  UpdateRetentionPolicyDto,
} from './document-retention.dto';
import { DocumentRetentionService } from './document-retention.service';

/** Retention policies, purge preview/run and run reports. */
@Controller('store/documents/retention')
@UseGuards(PermissionsGuard, IndustryModuleGuard)
@IndustryModule('documents')
export class DocumentRetentionController {
  constructor(
    private readonly retention: DocumentRetentionService,
    private readonly responseService: ResponseService,
  ) {}

  @Get('policies')
  @Permissions('store:workflows:design')
  async policies() {
    return this.responseService.success(await this.retention.listPolicies());
  }

  @Post('policies')
  @Permissions('store:workflows:design')
  async createPolicy(@Body() dto: CreateRetentionPolicyDto) {
    return this.responseService.success(await this.retention.createPolicy(dto));
  }

  @Patch('policies/:id')
  @Permissions('store:workflows:design')
  async updatePolicy(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRetentionPolicyDto) {
    return this.responseService.success(await this.retention.updatePolicy(id, dto));
  }

  @Delete('policies/:id')
  @HttpCode(200)
  @Permissions('store:workflows:design')
  async removePolicy(@Param('id', ParseIntPipe) id: number) {
    await this.retention.removePolicy(id);
    return this.responseService.success({ id });
  }

  /** What a purge would do now; deletes nothing. */
  @Get('preview')
  @Permissions('store:workflows:design')
  async preview() {
    return this.responseService.success(await this.retention.preview());
  }

  /** Manual purge. */
  @Post('runs')
  @Permissions('store:workflows:design')
  async run() {
    return this.responseService.success(await this.retention.run('manual'));
  }

  @Get('runs')
  @Permissions('store:workflows:design')
  async runs(@Query() query: PageQueryDto) {
    const r = await this.retention.listRuns(query);
    return this.responseService.paginated(r.data, r.total, r.page, r.limit);
  }

  @Get('runs/:id')
  @Permissions('store:workflows:design')
  async getRun(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.success(await this.retention.getRun(id));
  }
}
