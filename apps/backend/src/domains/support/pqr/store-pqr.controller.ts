import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import { RequestContextService } from '../../../common/context/request-context.service';
import { PqrService } from './pqr.service';
import { PqrQueryDto } from './dto/pqr-query.dto';
import { UpdatePqrDto } from './dto/update-pqr.dto';
import { UpdatePqrStatusDto } from './dto/update-pqr-status.dto';
import { AddPqrCommentDto } from './dto/add-pqr-comment.dto';
import { AssignPqrDto } from './dto/assign-pqr.dto';

/**
 * Store-admin endpoints for managing PQRs.
 *
 * - Lives under `/store/support/pqr` so the global DomainScopeGuard lets
 *   STORE_ADMIN apps through while blocking ORG_ADMIN/SUPER_ADMIN.
 * - JwtAuthGuard is global (APP_GUARD); we only apply PermissionsGuard here
 *   because permission checks are not enforced globally.
 * - All data is scoped internally to the Vendix platform organization
 *   (`is_platform: true`) because PQRs are platform-wide, not per-store.
 */
@ApiTags('Store PQR')
@Controller('store/support/pqr')
@UseGuards(PermissionsGuard)
@ApiBearerAuth()
export class StorePqrController {
  constructor(private readonly pqrService: PqrService) {}

  @Get()
  @Permissions('store:support:pqr:read')
  @ApiOperation({ summary: 'List PQRs with filters and pagination' })
  @ApiResponse({ status: 200, description: 'PQRs retrieved successfully' })
  findAll(@Query() query: PqrQueryDto) {
    return this.pqrService.adminFindAll(query);
  }

  @Get('stats')
  @Permissions('store:support:pqr:read')
  @ApiOperation({ summary: 'Get PQR statistics (count by status/type/priority)' })
  @ApiResponse({ status: 200, description: 'Stats retrieved successfully' })
  getStats() {
    return this.pqrService.adminGetStats();
  }

  @Get(':id')
  @Permissions('store:support:pqr:read')
  @ApiOperation({ summary: 'Get a single PQR by id' })
  @ApiResponse({ status: 200, description: 'PQR retrieved successfully' })
  findOne(@Param('id') id: string) {
    return this.pqrService.adminFindOne(+id);
  }

  @Patch(':id')
  @Permissions('store:support:pqr:update')
  @ApiOperation({ summary: 'Update PQR fields (priority, assignee, tags)' })
  @ApiResponse({ status: 200, description: 'PQR updated successfully' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePqrDto,
  ) {
    const userId = this.requireUserId();
    return this.pqrService.adminUpdate(+id, dto, userId);
  }

  @Patch(':id/status')
  @Permissions('store:support:pqr:status')
  @ApiOperation({ summary: 'Change PQR status (triggers email on RESOLVED/CLOSED)' })
  @ApiResponse({ status: 200, description: 'Status updated successfully' })
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdatePqrStatusDto,
  ) {
    const userId = this.requireUserId();
    return this.pqrService.adminUpdateStatus(+id, dto, userId);
  }

  @Patch(':id/assign')
  @Permissions('store:support:pqr:assign')
  @ApiOperation({ summary: 'Assign a PQR to a user' })
  @ApiResponse({ status: 200, description: 'PQR assigned successfully' })
  assign(
    @Param('id') id: string,
    @Body() dto: AssignPqrDto,
  ) {
    const userId = this.requireUserId();
    return this.pqrService.adminAssign(+id, dto, userId);
  }

  @Post(':id/comments')
  @Permissions('store:support:pqr:comment')
  @ApiOperation({
    summary:
      'Add a comment to a PQR. Internal comments stay admin-only; public comments trigger an email to the requester.',
  })
  @ApiResponse({ status: 201, description: 'Comment added successfully' })
  addComment(
    @Param('id') id: string,
    @Body() dto: AddPqrCommentDto,
  ) {
    const userId = this.requireUserId();
    return this.pqrService.adminAddComment(+id, dto, userId);
  }

  /**
   * Resolves the current user from the request context. Mirrors the
   * `if (!userId) ...` pattern in `TicketsController`, but throws a
   * typed VendixHttpException instead of returning a soft failure.
   */
  private requireUserId(): number {
    const userId = RequestContextService.getUserId();
    if (!userId) {
      throw new VendixHttpException(ErrorCodes.AUTH_CONTEXT_001);
    }
    return userId;
  }
}