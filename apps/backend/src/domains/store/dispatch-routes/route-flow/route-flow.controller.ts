import {
  Controller,
  Post,
  Body,
  Param,
  Res,
  UseGuards,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { RouteFlowService } from './route-flow.service';
import {
  CloseDispatchRouteDto,
  ReleaseStopDto,
  SettleStopDto,
  VoidDispatchRouteDto,
} from '../dto';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';

@Controller('store/dispatch-routes')
@UseGuards(PermissionsGuard)
export class RouteFlowController {
  constructor(
    private readonly routeFlowService: RouteFlowService,
    private readonly responseService: ResponseService,
  ) {}

  @Post(':id/dispatch')
  @HttpCode(HttpStatus.OK)
  @Permissions('store:dispatch_routes:dispatch')
  async dispatch(@Param('id', ParseIntPipe) id: number) {
    const result = await this.routeFlowService.dispatch(id);
    return this.responseService.success(result, 'Planilla despachada');
  }

  @Post(':id/stops/:stopId/start')
  @HttpCode(HttpStatus.OK)
  @Permissions('store:dispatch_routes:settle')
  async startStop(
    @Param('id', ParseIntPipe) id: number,
    @Param('stopId', ParseIntPipe) stopId: number,
  ) {
    const result = await this.routeFlowService.startStop(id, stopId);
    return this.responseService.success(result, 'Parada iniciada');
  }

  @Post(':id/stops/:stopId/settle')
  @HttpCode(HttpStatus.OK)
  @Permissions('store:dispatch_routes:settle')
  async settleStop(
    @Param('id', ParseIntPipe) id: number,
    @Param('stopId', ParseIntPipe) stopId: number,
    @Body() dto: SettleStopDto,
  ) {
    const result = await this.routeFlowService.settleStop(id, stopId, dto);
    return this.responseService.success(result, 'Parada liquidada');
  }

  @Post(':id/stops/:stopId/release')
  @HttpCode(HttpStatus.OK)
  @Permissions('store:dispatch_routes:release_stop')
  async releaseStop(
    @Param('id', ParseIntPipe) id: number,
    @Param('stopId', ParseIntPipe) stopId: number,
    @Body() dto: ReleaseStopDto,
  ) {
    const result = await this.routeFlowService.releaseStop(id, stopId, dto);
    return this.responseService.success(
      result,
      'Parada liberada para reasignación',
    );
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @Permissions('store:dispatch_routes:close')
  async close(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CloseDispatchRouteDto,
  ) {
    const result = await this.routeFlowService.close(id, dto);
    return this.responseService.success(result, 'Planilla cerrada');
  }

  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  @Permissions('store:dispatch_routes:void')
  async void(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: VoidDispatchRouteDto,
  ) {
    const result = await this.routeFlowService.void(id, dto);
    return this.responseService.success(result, 'Planilla anulada');
  }

  @Post(':id/pdf')
  @HttpCode(HttpStatus.OK)
  @Permissions('store:dispatch_routes:print')
  async generatePdf(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    const buffer = await this.routeFlowService.generatePdf(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="planilla-${id}.pdf"`,
      'Content-Length': buffer.length.toString(),
    });
    res.end(buffer);
  }
}
