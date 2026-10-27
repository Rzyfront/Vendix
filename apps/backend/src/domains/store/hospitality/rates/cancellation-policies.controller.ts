import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { LodgingCancellationPoliciesService } from './cancellation-policies.service';
import { CreateCancellationPolicyDto, UpdateCancellationPolicyDto } from './dto';

/** Hospitality Suite (H2.4) — cancellation policies assigned to rate plans. */
@Controller('store/hospitality/cancellation-policies')
@UseGuards(PermissionsGuard)
export class LodgingCancellationPoliciesController {
  constructor(
    private readonly policiesService: LodgingCancellationPoliciesService,
    private readonly responseService: ResponseService,
  ) {}

  @ApiOperation({ summary: 'Listar las políticas de cancelación' })
  @Get()
  @Permissions('store:lodging:rates:read')
  async findAll() {
    const result = await this.policiesService.findAll();
    return this.responseService.success(result);
  }

  @ApiOperation({ summary: 'Crear una política de cancelación' })
  @Post()
  @Permissions('store:lodging:rates:write')
  async create(@Body() dto: CreateCancellationPolicyDto) {
    const result = await this.policiesService.create(dto);
    return this.responseService.created(result, 'Política creada exitosamente');
  }

  @ApiOperation({ summary: 'Editar o desactivar una política de cancelación' })
  @Patch(':id')
  @Permissions('store:lodging:rates:write')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCancellationPolicyDto) {
    const result = await this.policiesService.update(id, dto);
    return this.responseService.updated(result, 'Política actualizada exitosamente');
  }
}
