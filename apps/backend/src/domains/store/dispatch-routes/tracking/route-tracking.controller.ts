import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Req,
  Sse,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable, interval, map, merge } from 'rxjs';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';
import { RouteTrackingService } from './route-tracking.service';
import { RouteTrackingSseService } from './route-tracking-sse.service';
import { PublishPositionsDto } from './dto/publish-positions.dto';

@Controller('store/dispatch-routes')
@UseGuards(PermissionsGuard)
export class RouteTrackingController {
  constructor(
    private readonly trackingService: RouteTrackingService,
    private readonly trackingSse: RouteTrackingSseService,
    private readonly responseService: ResponseService,
  ) {}

  @Post(':id/tracking/positions')
  @HttpCode(HttpStatus.OK)
  @Permissions('store:dispatch_routes:read:one')
  async publish(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PublishPositionsDto,
  ) {
    const result = await this.trackingService.publishPositions(id, dto);
    return this.responseService.success(result, 'Posiciones registradas');
  }

  @Get(':id/tracking')
  @Permissions('store:dispatch_routes:read:one')
  async getTracking(@Param('id', ParseIntPipe) id: number) {
    const result = await this.trackingService.getTracking(id);
    return this.responseService.success(result);
  }

  /**
   * SSE: no `@Query()` DTO (forbidNonWhitelisted would reject `?token=`);
   * auth by `?token=` is resolved by the global guard/context interceptor.
   */
  @Sse(':id/tracking/stream')
  @Permissions('store:dispatch_routes:read:one')
  async stream(
    @Param('id', ParseIntPipe) id: number,
    @Req() _req: Request,
  ): Promise<Observable<MessageEvent>> {
    // Validated while the request context (ALS) is still alive.
    await this.trackingService.assertRouteAccessible(id);

    const events$ = this.trackingSse
      .stream(id)
      .pipe(map((pos) => ({ data: pos }) as MessageEvent));
    const heartbeat$ = interval(25_000).pipe(
      map(() => ({ data: `: heartbeat ${Date.now()}` }) as MessageEvent),
    );
    return merge(events$, heartbeat$);
  }
}
