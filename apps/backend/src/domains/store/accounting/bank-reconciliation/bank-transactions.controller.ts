import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import {
  ModuleFlowGuard,
  RequireModuleFlow,
} from '../../../../common/guards/module-flow.guard';
import { UseGuards, UseInterceptors, UploadedFile } from '@nestjs/common';
import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { BankTransactionsService } from './bank-transactions.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { QueryBankTransactionDto } from './dto/query-bank-transaction.dto';

@Controller('store/accounting/bank-reconciliation/transactions')
@UseGuards(ModuleFlowGuard, PermissionsGuard)
@RequireModuleFlow('accounting')
export class BankTransactionsController {
  constructor(
    private readonly bank_transactions_service: BankTransactionsService,
    private readonly response_service: ResponseService,
  ) {}

  @Get()
  @Permissions('store:accounting:bank_reconciliation:read')
  async findAll(@Query() query_dto: QueryBankTransactionDto) {
    const result = await this.bank_transactions_service.findAll(query_dto);
    return this.response_service.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
    );
  }

  @Post('import')
  @Permissions('store:accounting:bank_reconciliation:create')
  @UseInterceptors(FileInterceptor('file'))
  @HttpCode(HttpStatus.CREATED)
  async importStatement(
    @UploadedFile() file: Express.Multer.File,
    @Body('bank_account_id') bank_account_id: string,
  ) {
    const result = await this.bank_transactions_service.importStatement(
      +bank_account_id,
      file.buffer,
      file.originalname,
    );
    return this.response_service.success(
      result,
      'Statement imported successfully',
    );
  }

  @Post('import/preview')
  @Permissions('store:accounting:bank_reconciliation:read')
  @UseInterceptors(FileInterceptor('file'))
  async previewImport(
    @UploadedFile() file: Express.Multer.File,
    @Body('bank_account_id') bank_account_id: string,
  ) {
    const result = await this.bank_transactions_service.previewImport(
      +bank_account_id,
      file.buffer,
      file.originalname,
    );
    return this.response_service.success(result);
  }

  @Delete(':id')
  @Permissions('store:accounting:bank_reconciliation:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    await this.bank_transactions_service.remove(+id);
    return this.response_service.success(
      null,
      'Transaction deleted successfully',
    );
  }
}
