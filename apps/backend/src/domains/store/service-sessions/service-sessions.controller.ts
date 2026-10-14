import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { defer, filter, from, interval, map, merge, Observable } from 'rxjs';
import { MessageEvent } from '@nestjs/common';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequestContextService } from '@common/context/request-context.service';
import { ResponseService } from '@common/responses/response.service';
import { ExtendServiceSessionDto, ListActiveServiceSessionsDto, OpenServiceSessionDto, ServiceSessionTransitionDto } from './dto/service-session.dto';
import { ReissueServiceSessionLinkDto } from './dto/reissue-service-session-link.dto';
import { ServiceSessionsService } from './service-sessions.service';

@Controller('store/service-sessions')
@UseGuards(PermissionsGuard)
export class ServiceSessionsController {
  constructor(
    private readonly sessions: ServiceSessionsService,
    private readonly response: ResponseService,
  ) {}

  @Post()
  @Permissions('store:reservations:update')
  async open(@Body() dto: OpenServiceSessionDto) {
    return this.response.created(await this.sessions.open(dto), 'Atención abierta');
  }

  @Get()
  @Permissions('store:reservations:read')
  async listActive(@Query() query: ListActiveServiceSessionsDto) {
    return this.response.success(await this.sessions.listActive(query.cursor));
  }

  @Patch(':id')
  @Permissions('store:reservations:update')
  async transition(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ServiceSessionTransitionDto,
  ) {
    return this.response.updated(await this.sessions.transition(id, dto), 'Atención actualizada');
  }

  @Patch(':id/extend')
  @Permissions('store:reservations:update')
  async extend(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ExtendServiceSessionDto,
  ) {
    return this.response.updated(await this.sessions.extend(id, new Date(dto.planned_end_at)), 'Atención extendida');
  }

  @Post(':id/access-link/reissue')
  @Permissions('store:reservations:update')
  async reissueAccessLink(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReissueServiceSessionLinkDto,
  ) {
    return this.response.updated(await this.sessions.reissueAccessLink(id, dto), 'Enlace temporal reemitido');
  }

  @Get(':id')
  @Permissions('store:reservations:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.response.success(await this.sessions.findOne(id));
  }

  @Sse(':id/stream')
  @Permissions('store:reservations:read')
  stream(@Param('id', ParseIntPipe) id: number, @Req() req: Request): Observable<MessageEvent> {
    const context = RequestContextService.getContext();
    if (!context?.store_id) return from([]);
    const snapshotContext = context;
    const live = this.sessions.streamForStore(context.store_id);
    req.on('close', () => live.unsubscribe());

    const snapshot$ = defer(() => from(RequestContextService.run(snapshotContext, async () => ({
      type: 'snapshot',
      data: await this.sessions.publicProgress(id),
    })))).pipe(map((event) => ({ data: JSON.stringify(event) }) as MessageEvent));
    const live$ = live.observable.pipe(
      filter((event) => event.data?.session_id === id),
      map((event) => ({ data: JSON.stringify(event) }) as MessageEvent),
    );
    const heartbeat$ = interval(30_000).pipe(map(() => ({ data: `: heartbeat ${Date.now()}` }) as MessageEvent));
    return merge(snapshot$, live$, heartbeat$);
  }
}
