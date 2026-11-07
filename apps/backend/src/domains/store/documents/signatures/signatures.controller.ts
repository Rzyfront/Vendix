import { Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { RequestContextService } from '@common/context/request-context.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { IndustryModuleGuard } from '../../../../common/guards/industry-module.guard';
import { IndustryModule } from '../../../../common/decorators/industry-module.decorator';
import { CancelSignatureRequestDto, CreateSignatureRequestDto } from './dto/signature.dto';
import { SignatureRequestsService } from './signature-requests.service';

/** Firma electrónica (P4.2), lado de la tienda: enviar a firmar, ver la evidencia, cancelar. */
@Controller('store/documents/signatures')
@UseGuards(PermissionsGuard, IndustryModuleGuard)
@IndustryModule('flows')
export class SignaturesController {
  constructor(
    private readonly requests: SignatureRequestsService,
    private readonly responseService: ResponseService,
  ) {}

  @Post()
  @Permissions('store:workflows:manage')
  async create(@Body() dto: CreateSignatureRequestDto) {
    const userId = RequestContextService.getContext()?.user_id ?? null;
    const created = await this.requests.create(dto, { type: 'user', id: userId });
    return this.responseService.created(created, 'Documento enviado a firmar');
  }

  @Get('instances/:instanceId')
  @Permissions('store:documents:read')
  async byInstance(@Param('instanceId', ParseIntPipe) instanceId: number) {
    return this.responseService.success(await this.requests.listByInstance(instanceId));
  }

  @Get(':id')
  @Permissions('store:documents:read')
  async get(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.success(await this.requests.get(id));
  }

  @Get(':id/sealed')
  @Permissions('store:documents:read')
  async sealed(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.success(await this.requests.sealedDownload(id));
  }

  @Post(':id/cancel')
  @Permissions('store:workflows:manage')
  async cancel(@Param('id', ParseIntPipe) id: number, @Body() dto: CancelSignatureRequestDto) {
    return this.responseService.success(await this.requests.cancel(id, dto.reason), 'Solicitud de firma cancelada');
  }
}
