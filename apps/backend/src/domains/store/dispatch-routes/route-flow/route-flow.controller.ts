import {
  Controller,
  Post,
  Body,
  Param,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { RouteFlowService } from './route-flow.service';
import { RouteSheetScannerService } from './route-sheet-scanner.service';
import {
  CloseDispatchRouteDto,
  ReleaseStopDto,
  SettleStopDto,
  VoidDispatchRouteDto,
} from '../dto';
import {
  ConfirmRouteSheetDto,
  RouteSheetScanResult,
} from './dto/scan-route-sheet.dto';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';

@Controller('store/dispatch-routes')
@UseGuards(PermissionsGuard)
export class RouteFlowController {
  constructor(
    private readonly routeFlowService: RouteFlowService,
    private readonly routeSheetScanner: RouteSheetScannerService,
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

  // ===== Route-sheet AI scanner =====

  @Post(':id/scan')
  @HttpCode(HttpStatus.OK)
  @Permissions('store:dispatch_routes:update')
  @UseInterceptors(FileInterceptor('file'))
  async scanRouteSheet(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const result = await this.routeSheetScanner.scanRouteSheet(id, file);
    return this.responseService.success(result, 'Planilla escaneada');
  }

  @Post(':id/scan/match')
  @HttpCode(HttpStatus.OK)
  @Permissions('store:dispatch_routes:update')
  async matchRouteSheet(
    @Param('id', ParseIntPipe) id: number,
    @Body() scan: RouteSheetScanResult,
  ) {
    const result = await this.routeSheetScanner.matchStops(id, scan);
    return this.responseService.success(
      result,
      'Coincidencias de paradas encontradas',
    );
  }

  @Post(':id/scan/confirm')
  @HttpCode(HttpStatus.OK)
  @Permissions('store:dispatch_routes:update')
  @UseInterceptors(FileInterceptor('file'))
  async confirmRouteSheet(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
    // Multipart transport: pull the JSON-encoded `stops` and `scan_result`
    // fields off the raw request body and parse them here. @Body() with
    // `ConfirmRouteSheetDto` would arrive as a flat object whose `stops`
    // is a string (not yet parsed) and `class-validator`'s @Transform
    // decorators only fire for JSON bodies, not multipart/form-data.
    @Body() raw: Record<string, unknown>,
  ) {
    const dto = this.parseConfirmDto(raw);
    const result = await this.routeSheetScanner.confirmAndSettle(
      id,
      file,
      dto,
    );
    return this.responseService.success(
      result,
      'Planilla liquidada desde escaneo',
    );
  }

  /**
   * Build a `ConfirmRouteSheetDto` from a multipart body. The frontend
   * sends the `stops` array and the `scan_result` object as JSON-encoded
   * strings (FormData cannot carry structured payloads natively).
   */
  private parseConfirmDto(raw: Record<string, unknown>): ConfirmRouteSheetDto {
    const stopsRaw = raw['stops'];
    const stops: ConfirmRouteSheetDto['stops'] = Array.isArray(stopsRaw)
      ? (stopsRaw as ConfirmRouteSheetDto['stops'])
      : typeof stopsRaw === 'string' && stopsRaw.length > 0
        ? JSON.parse(stopsRaw)
        : [];

    const scanRaw = raw['scan_result'];
    const scan_result: ConfirmRouteSheetDto['scan_result'] =
      scanRaw == null
        ? undefined
        : typeof scanRaw === 'string' && scanRaw.length > 0
          ? JSON.parse(scanRaw)
          : (scanRaw as ConfirmRouteSheetDto['scan_result']);

    return { stops, scan_result };
  }
}
