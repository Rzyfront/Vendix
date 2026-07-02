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
import { GymMemberProfilesService } from './gym-member-profiles.service';
import { UpsertMemberProfileDto } from './dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';

/**
 * Store-scoped member profiles (Gym Suite — Ola 1). One profile per
 * (store, customer). Shares the `store:gym_memberships` permission family.
 *
 *   - GET  :customerId → store:gym_memberships:read
 *   - PUT  :customerId → store:gym_memberships:update (upsert)
 */
@Controller('store/gym/member-profiles')
@UseGuards(PermissionsGuard)
export class GymMemberProfilesController {
  constructor(
    private readonly service: GymMemberProfilesService,
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
  @Permissions('store:gym_memberships:read')
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
  @Permissions('store:gym_memberships:update')
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
