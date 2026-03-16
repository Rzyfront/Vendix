import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { UseGuards } from '@nestjs/common';
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { QueryAccountDto } from './dto/query-account.dto';

@Controller('store/accounting/chart-of-accounts')
@UseGuards(PermissionsGuard)
export class ChartOfAccountsController {
  constructor(
    private readonly chart_of_accounts_service: ChartOfAccountsService,
    private readonly response_service: ResponseService,
  ) {}

  @Get()
  @Permissions('store:accounting:chart_of_accounts:read')
  async findAll(@Query() query_dto: QueryAccountDto) {
    const result = await this.chart_of_accounts_service.findAll(query_dto);
    return this.response_service.success(result);
  }

  // --- Static routes BEFORE :id ---

  @Get('tree')
  @Permissions('store:accounting:chart_of_accounts:read')
  async getTree() {
    const result = await this.chart_of_accounts_service.getTree();
    return this.response_service.success(result);
  }

  // --- Parameter routes ---

  @Get(':id')
  @Permissions('store:accounting:chart_of_accounts:read')
  async findOne(@Param('id') id: string) {
    const result = await this.chart_of_accounts_service.findOne(+id);
    return this.response_service.success(result);
  }

  @Post()
  @Permissions('store:accounting:chart_of_accounts:create')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() create_dto: CreateAccountDto) {
    const result = await this.chart_of_accounts_service.create(create_dto);
    return this.response_service.success(result, 'Account created successfully');
  }

  @Put(':id')
  @Permissions('store:accounting:chart_of_accounts:update')
  async update(
    @Param('id') id: string,
    @Body() update_dto: UpdateAccountDto,
  ) {
    const result = await this.chart_of_accounts_service.update(+id, update_dto);
    return this.response_service.success(result, 'Account updated successfully');
  }

  @Delete(':id')
  @Permissions('store:accounting:chart_of_accounts:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    await this.chart_of_accounts_service.remove(+id);
    return this.response_service.success(null, 'Account deleted successfully');
  }
}
