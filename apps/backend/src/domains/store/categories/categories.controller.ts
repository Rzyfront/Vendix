import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto, UpdateCategoryDto, CategoryQueryDto } from './dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { Req } from '@nestjs/common';
import { AuthenticatedRequest } from '@common/interfaces/authenticated-request.interface';
import { ResponseService } from '@common/responses/response.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

@Controller('store/categories')
@UseGuards(PermissionsGuard)
export class CategoriesController {
  constructor(
    private readonly categoriesService: CategoriesService,
    private readonly responseService: ResponseService,
  ) {}

  @Post()
  @Permissions('store:categories:create')
  async create(
    @Body() createCategoryDto: CreateCategoryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const result = await this.categoriesService.create(
      createCategoryDto,
      req.user,
    );
    return this.responseService.created(
      result,
      'Categoría creada exitosamente',
    );
  }

  @Get()
  @Permissions('store:categories:read')
  async findAll(@Query() query: CategoryQueryDto) {
    const result = await this.categoriesService.findAll(query);
    if (result.data && result.meta) {
      return this.responseService.paginated(
        result.data,
        result.meta.total,
        result.meta.page,
        result.meta.limit,
        'Categorías obtenidas exitosamente',
      );
    }
    return this.responseService.success(
      result,
      'Categorías obtenidas exitosamente',
    );
  }

  @Get('search')
  @Permissions('store:categories:read')
  async search(@Query() query: CategoryQueryDto) {
    const result = await this.categoriesService.findAll({
      ...query,
      search: query.search || '',
    });
    return this.responseService.success(
      result.data || result,
      'Búsqueda de categorías completada',
    );
  }

  @Post('upload-image')
  @Permissions('store:categories:update')
  @UseInterceptors(FileInterceptor('file'))
  async uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new VendixHttpException(ErrorCodes.MEDIA_FILE_REQUIRED_001);
    }

    if (!file.mimetype.startsWith('image/')) {
      throw new VendixHttpException(ErrorCodes.MEDIA_FILE_TYPE_001);
    }

    const result = await this.categoriesService.uploadCategoryImage(
      file.buffer,
      `category-${Date.now()}.webp`,
    );

    return this.responseService.created(result, 'Imagen subida exitosamente');
  }

  @Get(':id')
  @Permissions('store:categories:read')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @Query('include_inactive') includeInactive?: string,
  ) {
    const result = await this.categoriesService.findOne(id, {
      includeInactive: includeInactive === 'true',
    });
    return this.responseService.success(
      result,
      'Categoría obtenida exitosamente',
    );
  }

  @Patch(':id')
  @Permissions('store:categories:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateCategoryDto: UpdateCategoryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const result = await this.categoriesService.update(
      id,
      updateCategoryDto,
      req.user,
    );
    return this.responseService.updated(
      result,
      'Categoría actualizada exitosamente',
    );
  }

  @Put(':id')
  @Permissions('store:categories:update')
  async replace(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateCategoryDto: UpdateCategoryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const result = await this.categoriesService.update(
      id,
      updateCategoryDto,
      req.user,
    );
    return this.responseService.updated(
      result,
      'Categoría actualizada exitosamente',
    );
  }

  @Delete(':id')
  @Permissions('store:categories:delete')
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
    @Query('force') force?: string,
  ) {
    await this.categoriesService.remove(id, req.user, {
      force: force === 'true',
    });
    return this.responseService.deleted('Categoría eliminada exitosamente');
  }
}
