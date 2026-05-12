import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
  Req,
} from '@nestjs/common';
import { InvoiceDataRequestsService } from './invoice-data-requests.service';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { AuthenticatedRequest } from '@common/interfaces/authenticated-request.interface';
import { ResponseService } from '@common/responses/response.service';

@Controller('store/invoice-data-requests')
@UseGuards(RolesGuard, PermissionsGuard)
export class InvoiceDataRequestsController {
  constructor(
    private readonly service: InvoiceDataRequestsService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  async findAll(
    @Req() req: AuthenticatedRequest,
    @Query('status') status?: string,
  ) {
    if (!req.user.store_id) throw new Error('Store context required');
    const result = await this.service.findByStore(req.user.store_id, status);
    return this.responseService.success(result);
  }

  @Post(':id/process')
  async process(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    if (!req.user.store_id) throw new Error('Store context required');
    const result = await this.service.processRequest(id, req.user.store_id);
    return this.responseService.success(
      result,
      'Solicitud procesada correctamente',
    );
  }
}
