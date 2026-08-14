import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { MembershipNotesService } from './membership-notes.service';
import {
  BulkSetMembershipNotesDto,
  SetMembershipNoteDto,
} from './dto/membership-note.dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';

/**
 * Store-scoped member notes (`membership_member_notes`). Same permission
 * family as the rest of the membership module.
 *
 *   - GET    /store/memberships/member-notes?customer_id=&important_only=
 *   - GET    /store/memberships/member-notes/:customerId
 *   - GET    /store/memberships/member-notes/:customerId/:noteKey
 *   - PUT    /store/memberships/member-notes/:customerId  (single upsert)
 *   - POST   /store/memberships/member-notes/:customerId/bulk  (bulk upsert)
 *   - DELETE /store/memberships/member-notes/:customerId/:noteKey
 */
@Controller('store/memberships/member-notes')
@UseGuards(PermissionsGuard)
export class MembershipNotesController {
  constructor(
    private readonly service: MembershipNotesService,
    private readonly responseService: ResponseService,
  ) {}

  private fail(error: any, fallback: string): never {
    if (error instanceof VendixHttpException || error instanceof HttpException) {
      throw error;
    }
    throw new VendixHttpException(
      ErrorCodes.SYS_CONFLICT_001,
      error?.message || fallback,
    );
  }

  /**
   * List all notes for a customer. Use `?important_only=true` to filter
   * to notes flagged `include_in_summary` (the "Show in ficha" set).
   */
  @Get(':customerId')
  @Permissions('store:memberships:read')
  async list(
    @Param('customerId', ParseIntPipe) customerId: number,
    @Query('important_only') importantOnly?: string,
  ) {
    try {
      const rows = await this.service.findByCustomer(customerId, {
        importantOnly: importantOnly === 'true' || importantOnly === '1',
      });
      return this.responseService.success(
        rows,
        'Notas del socio obtenidas exitosamente',
      );
    } catch (error: any) {
      return this.fail(error, 'Error al obtener las notas del socio');
    }
  }

  /**
   * Single-note upsert by URL key. Body carries the note value.
   */
  @Put(':customerId')
  @Permissions('store:memberships:update')
  async setOne(
    @Param('customerId', ParseIntPipe) customerId: number,
    @Body() dto: SetMembershipNoteDto,
  ) {
    if (!dto?.note_key || !dto?.note_value) {
      throw new BadRequestException('note_key y note_value son requeridos');
    }
    try {
      const { row, created } = await this.service.upsertOne(customerId, dto);
      return this.responseService.success(
        { ...row, created },
        created ? 'Nota creada' : 'Nota actualizada',
      );
    } catch (error: any) {
      return this.fail(error, 'Error al guardar la nota del socio');
    }
  }

  /**
   * Bulk upsert for a single customer. Used by the bulk-scan commit
   * (QUI-558) to persist EPS, estado_fisico, lesiones, etc. in one tx.
   */
  @Post(':customerId/bulk')
  @Permissions('store:memberships:update')
  async bulkSet(
    @Param('customerId', ParseIntPipe) customerId: number,
    @Body() dto: BulkSetMembershipNotesDto,
  ) {
    try {
      const result = await this.service.bulkSet(customerId, dto);
      return this.responseService.success(
        result,
        `Notas guardadas (${result.created} creadas, ${result.updated} actualizadas)`,
      );
    } catch (error: any) {
      return this.fail(error, 'Error al guardar las notas del socio');
    }
  }

  /**
   * Single-note delete by key. Returns 204-style payload (no row means
   * "nothing to delete" — surfaced as `deleted: false`).
   */
  @Delete(':customerId/:noteKey')
  @Permissions('store:memberships:update')
  async deleteOne(
    @Param('customerId', ParseIntPipe) customerId: number,
    @Param('noteKey') noteKey: string,
  ) {
    try {
      const deleted = await this.service.deleteByKey(customerId, noteKey);
      return this.responseService.success(
        { deleted },
        deleted ? 'Nota eliminada' : 'Nota no encontrada',
      );
    } catch (error: any) {
      return this.fail(error, 'Error al eliminar la nota del socio');
    }
  }
}
