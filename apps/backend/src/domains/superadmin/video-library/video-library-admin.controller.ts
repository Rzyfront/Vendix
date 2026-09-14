import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Request,
  ParseIntPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { UserRole } from '../../auth/enums/user-role.enum';
import { VideoLibraryAdminService } from './video-library-admin.service';
import { CreateVideoDto } from './dto/create-video.dto';
import { UpdateVideoDto } from './dto/update-video.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { AdminVideoQueryDto } from './dto/video-query.dto';
import { ResponseService } from '@common/responses/response.service';

@Controller('superadmin/video-library')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class VideoLibraryAdminController {
  constructor(
    private readonly videoLibraryAdminService: VideoLibraryAdminService,
    private readonly responseService: ResponseService,
  ) {}

  // ==========================================
  // VIDEOS
  // ==========================================

  @Get('videos')
  async findAllVideos(@Query() query: AdminVideoQueryDto) {
    const data = await this.videoLibraryAdminService.findAllVideos(query);
    return this.responseService.success(data);
  }

  @Get('videos/stats')
  async getVideoStats() {
    const data = await this.videoLibraryAdminService.getVideoStats();
    return this.responseService.success(data);
  }

  @Get('videos/:id')
  async findVideoById(@Param('id', ParseIntPipe) id: number) {
    const data = await this.videoLibraryAdminService.findVideoById(id);
    return this.responseService.success(data);
  }

  @Post('videos')
  async createVideo(@Request() req: any, @Body() dto: CreateVideoDto) {
    const data = await this.videoLibraryAdminService.createVideo(req.user.id, dto);
    return this.responseService.success(data, 'Video creado exitosamente');
  }

  @Patch('videos/:id')
  async updateVideo(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateVideoDto,
  ) {
    const data = await this.videoLibraryAdminService.updateVideo(id, dto);
    return this.responseService.success(data, 'Video actualizado exitosamente');
  }

  @Delete('videos/:id')
  async deleteVideo(@Param('id', ParseIntPipe) id: number) {
    const data = await this.videoLibraryAdminService.deleteVideo(id);
    return this.responseService.success(data, 'Video eliminado exitosamente');
  }

  // ==========================================
  // CATEGORIES
  // ==========================================

  @Get('categories')
  async findAllCategories() {
    const data = await this.videoLibraryAdminService.findAllCategories();
    return this.responseService.success(data);
  }

  @Post('categories')
  async createCategory(@Body() dto: CreateCategoryDto) {
    const data = await this.videoLibraryAdminService.createCategory(dto);
    return this.responseService.success(data, 'Categoría creada exitosamente');
  }

  @Patch('categories/:id')
  async updateCategory(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCategoryDto,
  ) {
    const data = await this.videoLibraryAdminService.updateCategory(id, dto);
    return this.responseService.success(data, 'Categoría actualizada exitosamente');
  }

  @Delete('categories/:id')
  async deleteCategory(@Param('id', ParseIntPipe) id: number) {
    const data = await this.videoLibraryAdminService.deleteCategory(id);
    return this.responseService.success(data, 'Categoría eliminada exitosamente');
  }

  // ==========================================
  // THUMBNAIL UPLOAD
  // ==========================================

  @Post('upload-thumbnail')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  async uploadThumbnail(@UploadedFile() file: Express.Multer.File) {
    const data = await this.videoLibraryAdminService.uploadThumbnail(file);
    return this.responseService.success(data, 'Miniatura subida exitosamente');
  }
}
