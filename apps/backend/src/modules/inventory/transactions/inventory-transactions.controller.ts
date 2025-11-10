import {
  Controller,
  Get,
  Post,
  Query,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { InventoryTransactionsService } from './inventory-transactions.service';
import {
  CreateTransactionDto,
  TransactionQueryDto,
} from './interfaces/inventory-transaction.interface';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequirePermissions } from '../../auth/decorators/permissions.decorator';

@ApiTags('Inventory Transactions')
@Controller('inventory/transactions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class InventoryTransactionsController {
  constructor(
    private readonly transactionsService: InventoryTransactionsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create inventory transaction' })
  @ApiResponse({ status: 201, description: 'Transaction created successfully' })
  @RequirePermissions('create:inventory-transaction')
  async createTransaction(@Body() createTransactionDto: CreateTransactionDto) {
    return await this.transactionsService.createTransaction(
      createTransactionDto,
    );
  }

  @Get('product/:productId')
  @ApiOperation({ summary: 'Get transaction history for product' })
  @ApiResponse({
    status: 200,
    description: 'Transaction history retrieved successfully',
  })
  @RequirePermissions('read:inventory-transaction')
  async getProductTransactions(
    @Param('productId') productId: number,
    @Query() query: TransactionQueryDto,
  ) {
    return await this.transactionsService.getTransactionHistory(
      parseInt(productId.toString()),
      query,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get transaction by ID' })
  @ApiResponse({
    status: 200,
    description: 'Transaction retrieved successfully',
  })
  @RequirePermissions('read:inventory-transaction')
  async getTransactionById(@Param('id') id: number) {
    return await this.transactionsService.getTransactionById(id);
  }

  @Get('summary/:productId')
  @ApiOperation({ summary: 'Get transaction summary for product' })
  @ApiResponse({
    status: 200,
    description: 'Transaction summary retrieved successfully',
  })
  @RequirePermissions('read:inventory-transaction')
  async getTransactionSummary(
    @Param('productId') productId: number,
    @Query('variantId') variantId?: number,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return await this.transactionsService.getTransactionSummary(
      parseInt(productId.toString()),
      variantId ? parseInt(variantId.toString()) : undefined,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
  }

  @Get('recent/:organizationId')
  @ApiOperation({ summary: 'Get recent transactions for organization' })
  @ApiResponse({
    status: 200,
    description: 'Recent transactions retrieved successfully',
  })
  @RequirePermissions('read:inventory-transaction')
  async getRecentTransactions(
    @Param('organizationId') organizationId: string,
    @Query('limit') limit?: number,
  ) {
    return await this.transactionsService.getRecentTransactions(
      parseInt(organizationId.toString()),
      limit ? parseInt(limit.toString()) : undefined,
    );
  }
}
