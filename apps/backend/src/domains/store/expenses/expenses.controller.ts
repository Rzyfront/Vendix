import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
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
import { ExpensesService } from './expenses.service';
import { ExpenseFlowService } from './expense-flow/expense-flow.service';
import { ResponseService } from '../../../common/responses/response.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { QueryExpenseDto } from './dto/query-expense.dto';
import { CreateExpenseCategoryDto } from './dto/create-category.dto';
import { UpdateExpenseCategoryDto } from './dto/update-category.dto';
import { RefundExpenseDto } from './dto/refund-expense.dto';

@Controller('store/expenses')
@UseGuards(PermissionsGuard)
export class ExpensesController {
  constructor(
    private readonly expenses_service: ExpensesService,
    private readonly expense_flow_service: ExpenseFlowService,
    private readonly response_service: ResponseService,
  ) {}

  @Get()
  @Permissions('store:expenses:read')
  async findAll(@Query() query_dto: QueryExpenseDto) {
    const result = await this.expenses_service.findAll(query_dto);
    return this.response_service.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
    );
  }

  // --- Static Routes (MUST be before :id) ---

  @Get('categories')
  @Permissions('store:expenses:read')
  async findAllCategories() {
    const result = await this.expenses_service.findAllCategories();
    return this.response_service.success(result);
  }

  @Post('categories')
  @Permissions('store:expenses:create')
  @HttpCode(HttpStatus.CREATED)
  async createCategory(@Body() create_dto: CreateExpenseCategoryDto) {
    const result = await this.expenses_service.createCategory(create_dto);
    return this.response_service.success(
      result,
      'Category created successfully',
    );
  }

  @Put('categories/:id')
  @Permissions('store:expenses:update')
  async updateCategory(
    @Param('id') id: string,
    @Body() update_dto: UpdateExpenseCategoryDto,
  ) {
    const result = await this.expenses_service.updateCategory(+id, update_dto);
    return this.response_service.success(
      result,
      'Category updated successfully',
    );
  }

  @Delete('categories/:id')
  @Permissions('store:expenses:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeCategory(@Param('id') id: string) {
    await this.expenses_service.removeCategory(+id);
    return this.response_service.success(null, 'Category deleted successfully');
  }

  @Get('summary')
  @Permissions('store:expenses:read')
  async getSummary(
    @Query('date_from') date_from?: string,
    @Query('date_to') date_to?: string,
  ) {
    const dateFrom = date_from ? new Date(date_from) : undefined;
    const dateTo = date_to ? new Date(date_to) : undefined;

    const result = await this.expenses_service.getExpensesSummary(
      dateFrom,
      dateTo,
    );
    return this.response_service.success(result);
  }

  // --- Parameter Routes (MUST be last) ---

  @Get(':id')
  @Permissions('store:expenses:read')
  async findOne(@Param('id') id: string) {
    const result = await this.expenses_service.findOne(+id);
    return this.response_service.success(result);
  }

  @Post()
  @Permissions('store:expenses:create')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() create_dto: CreateExpenseDto) {
    const result = await this.expenses_service.create(create_dto);
    return this.response_service.success(
      result,
      'Expense created successfully',
    );
  }

  @Put(':id')
  @Permissions('store:expenses:update')
  async update(@Param('id') id: string, @Body() update_dto: UpdateExpenseDto) {
    const result = await this.expenses_service.update(+id, update_dto);
    return this.response_service.success(
      result,
      'Expense updated successfully',
    );
  }

  @Post(':id/approve')
  @Permissions('store:expenses:approve')
  @HttpCode(HttpStatus.OK)
  async approve(@Param('id') id: string) {
    const result = await this.expense_flow_service.approve(+id);
    return this.response_service.success(
      result,
      'Expense approved successfully',
    );
  }

  @Post(':id/reject')
  @Permissions('store:expenses:reject')
  @HttpCode(HttpStatus.OK)
  async reject(@Param('id') id: string) {
    const result = await this.expense_flow_service.reject(+id);
    return this.response_service.success(
      result,
      'Expense rejected successfully',
    );
  }

  @Post(':id/pay')
  @Permissions('store:expenses:pay')
  @HttpCode(HttpStatus.OK)
  async pay(@Param('id') id: string) {
    const result = await this.expense_flow_service.pay(+id);
    return this.response_service.success(
      result,
      'Expense marked as paid successfully',
    );
  }

  @Post(':id/refund')
  @Permissions('store:expenses:refund')
  @HttpCode(HttpStatus.OK)
  async refund(@Param('id') id: string, @Body() refund_dto: RefundExpenseDto) {
    const result = await this.expense_flow_service.refund(
      +id,
      refund_dto.reason,
    );
    return this.response_service.success(
      result,
      'Expense refunded successfully',
    );
  }

  @Post(':id/cancel')
  @Permissions('store:expenses:cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(@Param('id') id: string) {
    const result = await this.expense_flow_service.cancel(+id);
    return this.response_service.success(
      result,
      'Expense cancelled successfully',
    );
  }

  @Delete(':id')
  @Permissions('store:expenses:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    await this.expenses_service.remove(+id);
    return this.response_service.success(null, 'Expense deleted successfully');
  }
}
