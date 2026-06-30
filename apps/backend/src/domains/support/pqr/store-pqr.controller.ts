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
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
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
import { EditPqrCommentDto } from './dto/edit-pqr-comment.dto';
import { AssignPqrDto } from './dto/assign-pqr.dto';

/**
 * DTO for `PATCH /store/support/pqr/:id/content`. Every field is
 * optional — only the fields included in the body are updated. The
 * service diffs each included field against the current row and
 * skips no-op patches (no audit row written if nothing changed).
 */
export class EditPqrContentDto {
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(20)
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  requester_first_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  requester_last_name?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  requester_email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  requester_phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  requester_document_type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  requester_document_num?: string;
}

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

  /**
   * Allows the store-admin to fix typos in the title / description /
   * requester fields of a PQR they just created. Guarded server-side:
   * the ticket must still be in `NEW` status (not yet picked up by
   * the support team). Returns 400 SUP_PQR_006 if the status has
   * progressed.
   *
   * Why a separate endpoint from the generic `update`: content edits
   * carry an audit-trail cost (status_history row per edit) that
   * priority/assignee changes don't, and the auth is per-field
   * (requesters can only edit their own contact data).
   */
  @Patch(':id/content')
  @Permissions('store:support:pqr:update')
  @ApiOperation({
    summary:
      'Editar asunto / descripción / datos del solicitante (solo mientras el estado sea NUEVO)',
  })
  @ApiResponse({ status: 200, description: 'Contenido editado correctamente' })
  @ApiResponse({
    status: 400,
    description:
      'La solicitud ya pasó del estado NUEVO y no se puede editar',
  })
  editContent(
    @Param('id') id: string,
    @Body() dto: EditPqrContentDto,
  ) {
    const userId = this.requireUserId();
    return this.pqrService.editContent(
      +id,
      {
        title: dto.title,
        description: dto.description,
        requester_first_name: dto.requester_first_name,
        requester_last_name: dto.requester_last_name,
        requester_email: dto.requester_email,
        requester_phone: dto.requester_phone,
        requester_document_type: dto.requester_document_type,
        requester_document_num: dto.requester_document_num,
      },
      userId,
    );
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
      'Agregar un comentario a una PQRS. Los comentarios internos solo los ve el equipo de soporte; los comentarios públicos envían un correo al solicitante.',
  })
  @ApiResponse({ status: 201, description: 'Comentario agregado correctamente' })
  addComment(
    @Param('id') id: string,
    @Body() dto: AddPqrCommentDto,
  ) {
    const userId = this.requireUserId();
    return this.pqrService.adminAddComment(+id, dto, userId);
  }

  /**
   * Edit a comment's content. Server-side: only the original author
   * can edit (SUP_COMMENT_002 → 403) so attribution stays truthful.
   * Appends a status_history row noting the change so the History
   * card surfaces "Comentario editado por X" with the byte delta.
   */
  @Patch(':id/comments/:commentId')
  @Permissions('store:support:pqr:comment')
  @ApiOperation({ summary: 'Edit a comment (author only)' })
  @ApiResponse({ status: 200, description: 'Comment edited' })
  @ApiResponse({
    status: 403,
    description: 'Solo el autor original del comentario puede editarlo',
  })
  editComment(
    @Param('id') id: string,
    @Param('commentId') commentId: string,
    @Body() dto: EditPqrCommentDto,
  ) {
    const userId = this.requireUserId();
    return this.pqrService.adminUpdateComment(
      +id,
      +commentId,
      dto.content,
      userId,
    );
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