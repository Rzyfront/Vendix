import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ResolutionsService } from './resolutions.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { CreateResolutionDto } from './dto/create-resolution.dto';
import { UpdateResolutionDto } from './dto/update-resolution.dto';

@Controller('store/invoicing/resolutions')
export class ResolutionsController {
  constructor(
    private readonly resolutions_service: ResolutionsService,
    private readonly response_service: ResponseService,
  ) {}

  @Get()
  @Permissions('invoicing:read')
  async findAll() {
    const result = await this.resolutions_service.findAll();
    return this.response_service.success(result);
  }

  @Get(':id')
  @Permissions('invoicing:read')
  async findOne(@Param('id') id: string) {
    const result = await this.resolutions_service.findOne(+id);
    return this.response_service.success(result);
  }

  @Post()
  @Permissions('invoicing:write')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() create_dto: CreateResolutionDto) {
    const result = await this.resolutions_service.create(create_dto);
    return this.response_service.success(
      result,
      'Resolution created successfully',
    );
  }

  @Put(':id')
  @Permissions('invoicing:write')
  async update(
    @Param('id') id: string,
    @Body() update_dto: UpdateResolutionDto,
  ) {
    const result = await this.resolutions_service.update(+id, update_dto);
    return this.response_service.success(
      result,
      'Resolution updated successfully',
    );
  }

  @Delete(':id')
  @Permissions('invoicing:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    await this.resolutions_service.remove(+id);
    return this.response_service.success(
      null,
      'Resolution deleted successfully',
    );
  }
}
