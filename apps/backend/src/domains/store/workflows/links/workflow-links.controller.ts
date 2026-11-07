import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { WorkflowLinksQueryDto } from './workflow-links.dto';
import { WorkflowLinksService } from './workflow-links.service';

/**
 * P1.4: requests linked to a Vendix record (purchase order, expense, payroll
 * run…). Any authenticated member of the store may read it: the record screen
 * that shows the badge already required its own permission, and the answer
 * holds only reference, status and stage. No industry guard on purpose: other
 * industries get an empty answer, not a 403 on every purchase order screen.
 */
@Controller('store/workflow-links')
@UseGuards(PermissionsGuard)
export class WorkflowLinksController {
  constructor(
    private readonly links: WorkflowLinksService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  async forEntity(@Query() query: WorkflowLinksQueryDto) {
    const data = await this.links.forEntity(query.entity_type, query.entity_id);
    return this.responseService.success(data);
  }
}
