import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { UseGuards } from '@nestjs/common';
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { PromotionsService } from './promotions.service';
import { PromotionEngineService } from './promotion-engine/promotion-engine.service';
import { ResponseService } from '../../../common/responses/response.service';
import {
  CreatePromotionDto,
  UpdatePromotionDto,
  QueryPromotionsDto,
} from './dto';

@Controller('store/promotions')
@UseGuards(PermissionsGuard)
export class PromotionsController {
  constructor(
    private readonly promotions_service: PromotionsService,
    private readonly promotion_engine_service: PromotionEngineService,
    private readonly response_service: ResponseService,
  ) {}

  // --- Static Routes (MUST be before :id) ---

  @Get('summary')
  @Permissions('store:promotions:read')
  async getSummary() {
    const result = await this.promotions_service.getSummary();
    return this.response_service.success(result);
  }

  @Get('active')
  @Permissions('store:promotions:read')
  async getActive() {
    const result = await this.promotions_service.getActive();
    return this.response_service.success(result);
  }

  @Get()
  @Permissions('store:promotions:read')
  async findAll(@Query() query: QueryPromotionsDto) {
    const result = await this.promotions_service.findAll(query);
    return this.response_service.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
    );
  }

  @Post('check-eligibility')
  @Permissions('store:promotions:create')
  @HttpCode(HttpStatus.OK)
  async checkEligibility(@Body() body: { items: any[]; customer_id?: number }) {
    const result = await this.promotion_engine_service.getEligiblePromotions(
      body.items,
      body.customer_id,
    );
    return this.response_service.success(result);
  }

  // --- Parameter Routes (MUST be last) ---

  @Get(':id')
  @Permissions('store:promotions:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const result = await this.promotions_service.findOne(id);
    return this.response_service.success(result);
  }

  @Post()
  @Permissions('store:promotions:create')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreatePromotionDto) {
    const result = await this.promotions_service.create(dto);
    return this.response_service.success(
      result,
      'Promocion creada exitosamente',
    );
  }

  @Patch(':id')
  @Permissions('store:promotions:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePromotionDto,
  ) {
    const result = await this.promotions_service.update(id, dto);
    return this.response_service.success(
      result,
      'Promocion actualizada exitosamente',
    );
  }

  @Post(':id/activate')
  @Permissions('store:promotions:create')
  @HttpCode(HttpStatus.OK)
  async activate(@Param('id', ParseIntPipe) id: number) {
    const result = await this.promotions_service.activate(id);
    return this.response_service.success(
      result,
      'Promocion activada exitosamente',
    );
  }

  @Post(':id/pause')
  @Permissions('store:promotions:create')
  @HttpCode(HttpStatus.OK)
  async pause(@Param('id', ParseIntPipe) id: number) {
    const result = await this.promotions_service.pause(id);
    return this.response_service.success(
      result,
      'Promocion pausada exitosamente',
    );
  }

  @Post(':id/cancel')
  @Permissions('store:promotions:cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(@Param('id', ParseIntPipe) id: number) {
    const result = await this.promotions_service.cancel(id);
    return this.response_service.success(
      result,
      'Promocion cancelada exitosamente',
    );
  }

  @Delete(':id')
  @Permissions('store:promotions:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.promotions_service.remove(id);
    return this.response_service.success(
      null,
      'Promocion eliminada exitosamente',
    );
  }
}
