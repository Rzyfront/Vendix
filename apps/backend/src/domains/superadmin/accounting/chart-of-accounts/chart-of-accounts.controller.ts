import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { QueryAccountDto } from './dto/query-account.dto';

@Controller('super-admin/fiscal/accounting/chart-of-accounts')
@UseGuards(PermissionsGuard)
export class ChartOfAccountsController {
  constructor(
    private readonly chart_of_accounts_service: ChartOfAccountsService,
    private readonly response_service: ResponseService,
  ) {}

  @Get()
  @Permissions('superadmin:fiscal:accounting:read')
  async findAll(@Query() query_dto: QueryAccountDto) {
    if (query_dto.tree) {
      const result = await this.chart_of_accounts_service.getTree();
      return this.response_service.success(result);
    }
    const result = await this.chart_of_accounts_service.findAll(query_dto);
    return this.response_service.paginated(
      result.data,
      result.total,
      result.page,
      result.limit,
    );
  }

  @Get('tree')
  @Permissions('superadmin:fiscal:accounting:read')
  async getTree() {
    const result = await this.chart_of_accounts_service.getTree();
    return this.response_service.success(result);
  }

  @Get(':code')
  @Permissions('superadmin:fiscal:accounting:read')
  async findOne(@Param('code') code: string) {
    const result = await this.chart_of_accounts_service.findOne(code);
    return this.response_service.success(result);
  }

  @Post()
  @Permissions('superadmin:fiscal:accounting:create')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() create_dto: CreateAccountDto) {
    const result = await this.chart_of_accounts_service.create(create_dto);
    return this.response_service.created(result, 'Account created successfully');
  }

  @Patch(':code')
  @Permissions('superadmin:fiscal:accounting:update')
  async update(
    @Param('code') code: string,
    @Body() update_dto: UpdateAccountDto,
  ) {
    const result = await this.chart_of_accounts_service.update(code, update_dto);
    return this.response_service.updated(result, 'Account updated successfully');
  }
}
