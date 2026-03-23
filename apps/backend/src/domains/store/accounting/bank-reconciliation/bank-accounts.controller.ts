import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { UseGuards } from '@nestjs/common';
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { BankAccountsService } from './bank-accounts.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { UpdateBankAccountDto } from './dto/update-bank-account.dto';
import { QueryBankAccountDto } from './dto/query-bank-account.dto';

@Controller('store/accounting/bank-reconciliation/accounts')
@UseGuards(PermissionsGuard)
export class BankAccountsController {
  constructor(
    private readonly bank_accounts_service: BankAccountsService,
    private readonly response_service: ResponseService,
  ) {}

  @Get()
  @Permissions('store:accounting:bank_reconciliation:read')
  async findAll(@Query() query_dto: QueryBankAccountDto) {
    const result = await this.bank_accounts_service.findAll(query_dto);
    return this.response_service.success(result);
  }

  @Get(':id')
  @Permissions('store:accounting:bank_reconciliation:read')
  async findOne(@Param('id') id: string) {
    const result = await this.bank_accounts_service.findOne(+id);
    return this.response_service.success(result);
  }

  @Post()
  @Permissions('store:accounting:bank_reconciliation:create')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() create_dto: CreateBankAccountDto) {
    const result = await this.bank_accounts_service.create(create_dto);
    return this.response_service.success(result, 'Bank account created successfully');
  }

  @Patch(':id')
  @Permissions('store:accounting:bank_reconciliation:update')
  async update(
    @Param('id') id: string,
    @Body() update_dto: UpdateBankAccountDto,
  ) {
    const result = await this.bank_accounts_service.update(+id, update_dto);
    return this.response_service.success(result, 'Bank account updated successfully');
  }

  @Delete(':id')
  @Permissions('store:accounting:bank_reconciliation:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    await this.bank_accounts_service.remove(+id);
    return this.response_service.success(null, 'Bank account closed successfully');
  }
}
