import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { IndustryModuleGuard } from '../../../../common/guards/industry-module.guard';
import { IndustryModule } from '../../../../common/decorators/industry-module.decorator';
import { API_KEYS_MANAGE_PERMISSION } from './api-key.constants';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { StoreApiKeysService } from './store-api-keys.service';

/** API keys of the store. JWT only: an API key can never manage API keys. */
@Controller('store/integrations/api-keys')
@UseGuards(PermissionsGuard, IndustryModuleGuard)
@IndustryModule('flows')
export class StoreApiKeysController {
  constructor(
    private readonly keys: StoreApiKeysService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions(API_KEYS_MANAGE_PERMISSION)
  async list() {
    return this.responseService.success(await this.keys.list());
  }

  /** The `secret` in the response is shown once and cannot be recovered. */
  @Post()
  @Permissions(API_KEYS_MANAGE_PERMISSION)
  async create(@Body() dto: CreateApiKeyDto) {
    return this.responseService.created(
      await this.keys.create(dto),
      'API key creada. Copia el secreto ahora: no se volverá a mostrar.',
    );
  }

  @Delete(':id')
  @HttpCode(200)
  @Permissions(API_KEYS_MANAGE_PERMISSION)
  async revoke(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.updated(
      await this.keys.revoke(id),
      'API key revocada',
    );
  }
}
