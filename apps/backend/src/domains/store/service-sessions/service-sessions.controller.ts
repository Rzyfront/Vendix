import {
  Body,
  Controller,
  Delete,
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
import {
  AddSessionItemDto,
  AddSessionItemsBulkDto,
  ExtendServiceSessionDto,
  ListActiveServiceSessionsDto,
  OpenServiceSessionDto,
  ServiceIntakePrefillQueryDto,
  ServiceIntakeQueryDto,
  ServiceSessionTransitionDto,
} from './dto/service-session.dto';
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

  // Static routes MUST be declared before the `:id` routes.
  @Get('intake-template')
  @Permissions('store:reservations:read')
  async intakeTemplate(@Query() query: ServiceIntakeQueryDto) {
    return this.response.success(await this.sessions.getIntakeTemplate(query.product_id, query.station_id));
  }

  @Get('intake-prefill')
  @Permissions('store:reservations:read')
  async intakePrefill(@Query() query: ServiceIntakePrefillQueryDto) {
    return this.response.success(await this.sessions.getIntakePrefill(query.product_id, query.customer_id, query.station_id));
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

  @Post(':id/prepare-charge')
  @Permissions('store:reservations:update')
  async prepareCharge(@Param('id', ParseIntPipe) id: number) {
    return this.response.success(await this.sessions.prepareCharge(id));
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

  @Post(':id/items')
  @Permissions('store:reservations:update')
  async addItem(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddSessionItemDto,
  ) {
    return this.response.created(await this.sessions.addItem(id, dto), 'Producto o servicio agregado a la cuenta');
  }

  @Post(':id/items/bulk')
  @Permissions('store:reservations:update')
  async addItemsBulk(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddSessionItemsBulkDto,
  ) {
    return this.response.created(await this.sessions.addItemsBulk(id, dto.items), 'Productos cargados a la cuenta de la estación');
  }

  @Delete(':id/items/:itemId')
  @Permissions('store:reservations:update')
  async removeItem(
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
  ) {
    return this.response.success(await this.sessions.removeItem(id, itemId), 'Item eliminado de la cuenta');
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
