import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import {
  ReviewQueryDto,
  CreateReviewResponseDto,
  UpdateReviewResponseDto,
} from './dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';

@Controller('store/reviews')
@UseGuards(PermissionsGuard)
export class ReviewsController {
  constructor(
    private readonly reviewsService: ReviewsService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:reviews:read')
  async findAll(@Query() query: ReviewQueryDto) {
    try {
      const result = await this.reviewsService.findAll(query);
      return this.responseService.paginated(
        result.data,
        result.meta.total,
        result.meta.page,
        result.meta.limit,
        'Reseñas obtenidas exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener las reseñas',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get('stats')
  @Permissions('store:reviews:read')
  async getStats() {
    try {
      const result = await this.reviewsService.getStats();
      return this.responseService.success(result, 'Stats obtenidas exitosamente');
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener stats',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get(':id')
  @Permissions('store:reviews:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.reviewsService.findOne(id);
      return this.responseService.success(result, 'Reseña obtenida exitosamente');
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener la reseña',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Patch(':id/approve')
  @Permissions('store:reviews:moderate')
  async approve(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.reviewsService.approve(id);
      return this.responseService.updated(result, 'Reseña aprobada exitosamente');
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al aprobar la reseña',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Patch(':id/reject')
  @Permissions('store:reviews:moderate')
  async reject(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.reviewsService.reject(id);
      return this.responseService.updated(result, 'Reseña rechazada exitosamente');
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al rechazar la reseña',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Patch(':id/hide')
  @Permissions('store:reviews:moderate')
  async hide(@Param('id', ParseIntPipe) id: number) {
    try {
      const result = await this.reviewsService.hide(id);
      return this.responseService.updated(result, 'Reseña ocultada exitosamente');
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al ocultar la reseña',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Delete(':id')
  @Permissions('store:reviews:delete')
  async remove(@Param('id', ParseIntPipe) id: number) {
    try {
      await this.reviewsService.remove(id);
      return this.responseService.deleted('Reseña eliminada exitosamente');
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al eliminar la reseña',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Post(':id/response')
  @Permissions('store:reviews:respond')
  async createResponse(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateReviewResponseDto,
  ) {
    try {
      const result = await this.reviewsService.createResponse(id, dto);
      return this.responseService.created(result, 'Respuesta creada exitosamente');
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al crear la respuesta',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Patch(':id/response')
  @Permissions('store:reviews:respond')
  async updateResponse(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateReviewResponseDto,
  ) {
    try {
      const result = await this.reviewsService.updateResponse(id, dto);
      return this.responseService.updated(result, 'Respuesta actualizada exitosamente');
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al actualizar la respuesta',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Delete(':id/response')
  @Permissions('store:reviews:respond')
  async deleteResponse(@Param('id', ParseIntPipe) id: number) {
    try {
      await this.reviewsService.deleteResponse(id);
      return this.responseService.deleted('Respuesta eliminada exitosamente');
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al eliminar la respuesta',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }
}
