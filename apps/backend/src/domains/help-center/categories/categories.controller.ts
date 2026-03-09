import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { CategoriesService } from './categories.service';
import { Public } from '../../../common/decorators/public.decorator';

@ApiTags('Help Center - Categories')
@Controller('help-center/categories')
export class CategoriesController {
  constructor(private readonly categories_service: CategoriesService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'List active help article categories with article count' })
  async findAll() {
    return this.categories_service.findAll();
  }
}
