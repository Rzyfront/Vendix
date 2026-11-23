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
  Request,
  UseGuards,
} from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { Roles } from '../../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { UserRole } from '../../../auth/enums/user-role.enum';
import { VideoSeriesService } from './video-series.service';
import {
  CreateVideoSeriesDto,
  UpdateVideoSeriesDto,
  VideoSeriesQueryDto,
} from './dto/video-series.dto';

@Controller('superadmin/video-library/series')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class VideoSeriesController {
  constructor(
    private readonly seriesService: VideoSeriesService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  async findAll(@Query() query: VideoSeriesQueryDto) {
    const result = await this.seriesService.findAll(query);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
    );
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.success(await this.seriesService.findOne(id));
  }

  @Post()
  async create(@Request() req: any, @Body() dto: CreateVideoSeriesDto) {
    const data = await this.seriesService.create(req.user?.id, dto);
    return this.responseService.success(data, 'Serie creada exitosamente');
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateVideoSeriesDto,
  ) {
    const data = await this.seriesService.update(id, dto);
    return this.responseService.success(data, 'Serie actualizada exitosamente');
  }

  @Post(':id/publish')
  async publish(@Param('id', ParseIntPipe) id: number) {
    const data = await this.seriesService.publish(id);
    return this.responseService.success(data, 'Serie publicada exitosamente');
  }

  @Post(':id/unpublish')
  async unpublish(@Param('id', ParseIntPipe) id: number) {
    const data = await this.seriesService.unpublish(id);
    return this.responseService.success(data, 'Serie despublicada');
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    const data = await this.seriesService.remove(id);
    return this.responseService.success(data, 'Serie eliminada exitosamente');
  }
}
