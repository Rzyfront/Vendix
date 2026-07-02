import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { MemberProfilesService } from './member-profiles.service';
import { UpsertMemberProfileDto } from './dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';

/**
 * Store-scoped member profiles (generalized membership core). One profile per
 * (store, customer). Shares the `store:memberships` permission family.
 *
 *   - GET  :customerId → store:memberships:read
 *   - PUT  :customerId → store:memberships:update (upsert)
 */
@Controller('store/memberships/member-profiles')
@UseGuards(PermissionsGuard)
export class MemberProfilesController {
  constructor(
    private readonly service: MemberProfilesService,
    private readonly responseService: ResponseService,
  ) {}

  private fail(error: any, fallback: string) {
    return this.responseService.error(
      error.response?.message || error.message || fallback,
      error.response?.message || error.message,
      error.getStatus?.() ?? error.status ?? 400,
      error.errorCode,
    );
  }

  @Get(':customerId')
  @Permissions('store:memberships:read')
  async getByCustomer(@Param('customerId', ParseIntPipe) customerId: number) {
    try {
      const result = await this.service.getByCustomer(customerId);
      return this.responseService.success(
        result,
        'Perfil del socio obtenido exitosamente',
      );
    } catch (error: any) {
      return this.fail(error, 'Error al obtener el perfil del socio');
    }
  }

  @Put(':customerId')
  @Permissions('store:memberships:update')
  async upsert(
    @Param('customerId', ParseIntPipe) customerId: number,
    @Body() dto: UpsertMemberProfileDto,
  ) {
    try {
      const result = await this.service.upsert(customerId, dto);
      return this.responseService.success(
        result,
        'Perfil del socio guardado exitosamente',
      );
    } catch (error: any) {
      return this.fail(error, 'Error al guardar el perfil del socio');
    }
  }
}
