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
  HttpStatus,
  HttpCode,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { BrandsService } from './brands.service';
import { CreateBrandDto, UpdateBrandDto, BrandQueryDto } from './dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { Req } from '@nestjs/common';
import { AuthenticatedRequest } from '@common/interfaces/authenticated-request.interface';
import { ResponseService } from '@common/responses/response.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

@Controller('store/brands')
@UseGuards(PermissionsGuard)
export class BrandsController {
  constructor(
    private readonly brandsService: BrandsService,
    private readonly responseService: ResponseService,
  ) {}

  @Post()
  @Permissions('store:brands:create')
  async create(
    @Body() createBrandDto: CreateBrandDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const brand = await this.brandsService.create(createBrandDto, req.user);
    return this.responseService.created(brand, 'Marca creada exitosamente');
  }

  @Get()
  @Permissions('store:brands:read')
  async findAll(@Query() query: BrandQueryDto) {
    const result = await this.brandsService.findAll(query);

    if (result.data && result.meta) {
      return this.responseService.paginated(
        result.data,
        result.meta.total,
        result.meta.page,
        result.meta.limit,
        'Marcas obtenidas exitosamente',
      );
    } else {
      return this.responseService.success(
        result,
        'Marcas obtenidas exitosamente',
      );
    }
  }

  @Get('store/:storeId')
  @Permissions('store:brands:read')
  async findByStore(
    @Param('storeId', ParseIntPipe) storeId: number,
    @Query() query: BrandQueryDto,
  ) {
    const result = await this.brandsService.findByStore(storeId, query);

    if (result.data && result.meta) {
      return this.responseService.paginated(
        result.data,
        result.meta.total,
        result.meta.page,
        result.meta.limit,
        'Marcas de la tienda obtenidas exitosamente',
      );
    } else {
      return this.responseService.success(
        result,
        'Marcas de la tienda obtenidas exitosamente',
      );
    }
  }

  @Post('upload-logo')
  @Permissions('store:brands:update')
  @UseInterceptors(FileInterceptor('file'))
  async uploadLogo(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new VendixHttpException(ErrorCodes.MEDIA_FILE_REQUIRED_001);
    }

    if (!file.mimetype.startsWith('image/')) {
      throw new VendixHttpException(ErrorCodes.MEDIA_FILE_TYPE_001);
    }

    const result = await this.brandsService.uploadBrandLogo(
      file.buffer,
      `brand-${Date.now()}.webp`,
    );

    return this.responseService.created(result, 'Logo subido exitosamente');
  }

  @Get(':id')
  @Permissions('store:brands:read')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @Query('include_inactive') includeInactive?: string,
  ) {
    const brand = await this.brandsService.findOne(id, {
      includeInactive: includeInactive === 'true',
    });
    return this.responseService.success(brand, 'Marca obtenida exitosamente');
  }

  @Patch(':id')
  @Permissions('store:brands:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateBrandDto: UpdateBrandDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const brand = await this.brandsService.update(id, updateBrandDto, req.user);
    return this.responseService.updated(
      brand,
      'Marca actualizada exitosamente',
    );
  }

  @Delete(':id')
  @Permissions('store:brands:admin_delete')
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
    @Query('force') force?: string,
  ) {
    await this.brandsService.remove(id, req.user, {
      force: force === 'true',
    });
    return this.responseService.deleted('Marca eliminada exitosamente');
  }
}
