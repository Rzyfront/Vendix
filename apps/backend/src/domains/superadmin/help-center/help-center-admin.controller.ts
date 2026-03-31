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
import { HelpCenterAdminService } from './help-center-admin.service';
import { CreateArticleDto } from './dto/create-article.dto';
import { UpdateArticleDto } from './dto/update-article.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { AdminArticleQueryDto } from './dto/article-query.dto';
import { ResponseService } from '@common/responses/response.service';

@Controller('superadmin/help-center')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class HelpCenterAdminController {
  constructor(
    private readonly helpCenterService: HelpCenterAdminService,
    private readonly responseService: ResponseService,
  ) {}

  // ==========================================
  // ARTICLES
  // ==========================================

  @Get('articles')
  async findAllArticles(@Query() query: AdminArticleQueryDto) {
    const data = await this.helpCenterService.findAllArticles(query);
    return this.responseService.success(data);
  }

  @Get('articles/stats')
  async getArticleStats() {
    const data = await this.helpCenterService.getArticleStats();
    return this.responseService.success(data);
  }

  @Get('articles/:id')
  async findArticleById(@Param('id', ParseIntPipe) id: number) {
    const data = await this.helpCenterService.findArticleById(id);
    return this.responseService.success(data);
  }

  @Post('articles')
  async createArticle(@Request() req: any, @Body() dto: CreateArticleDto) {
    const data = await this.helpCenterService.createArticle(req.user.id, dto);
    return this.responseService.success(data, 'Article created successfully');
  }

  @Patch('articles/:id')
  async updateArticle(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateArticleDto,
  ) {
    const data = await this.helpCenterService.updateArticle(id, dto);
    return this.responseService.success(data, 'Article updated successfully');
  }

  @Delete('articles/:id')
  async deleteArticle(@Param('id', ParseIntPipe) id: number) {
    const data = await this.helpCenterService.deleteArticle(id);
    return this.responseService.success(data, 'Article deleted successfully');
  }

  // ==========================================
  // CATEGORIES
  // ==========================================

  @Get('categories')
  async findAllCategories() {
    const data = await this.helpCenterService.findAllCategories();
    return this.responseService.success(data);
  }

  @Post('categories')
  async createCategory(@Body() dto: CreateCategoryDto) {
    const data = await this.helpCenterService.createCategory(dto);
    return this.responseService.success(data, 'Category created successfully');
  }

  @Patch('categories/:id')
  async updateCategory(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCategoryDto,
  ) {
    const data = await this.helpCenterService.updateCategory(id, dto);
    return this.responseService.success(data, 'Category updated successfully');
  }

  @Delete('categories/:id')
  async deleteCategory(@Param('id', ParseIntPipe) id: number) {
    const data = await this.helpCenterService.deleteCategory(id);
    return this.responseService.success(data, 'Category deleted successfully');
  }

  // ==========================================
  // IMAGE UPLOAD
  // ==========================================

  @Post('upload-image')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async uploadImage(@UploadedFile() file: Express.Multer.File) {
    const data = await this.helpCenterService.uploadArticleImage(file);
    return this.responseService.success(data, 'Image uploaded successfully');
  }
}
