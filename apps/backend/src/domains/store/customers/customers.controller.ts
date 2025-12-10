import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Query,
  Body,
  Param,
  HttpStatus,
  HttpCode,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../domains/auth/guards/jwt-auth.guard';
import { Public } from '../../../domains/auth/decorators/public.decorator';
import { CustomersService } from './customers.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import {
  CreateCustomerDto,
  UpdateCustomerDto,
  ChangeCustomerStatusDto,
  CustomerQueryDto,
  CustomerStatsDto,
} from './dto';

@ApiTags('Store Customers')
@Controller('stores/customers')
export class CustomersController {
  constructor(
    private readonly customersService: CustomersService,
    private readonly prisma: StorePrismaService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new customer' })
  @ApiResponse({ status: 201, description: 'Customer created successfully' })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  @ApiResponse({ status: 409, description: 'Customer already exists' })
  async createCustomer(@Body() createCustomerDto: CreateCustomerDto) {
    const customer =
      await this.customersService.createCustomer(createCustomerDto);
    return {
      statusCode: HttpStatus.CREATED,
      message: 'Customer created successfully',
      data: customer,
    };
  }

  @Get()
  @ApiOperation({ summary: 'Get all customers' })
  @ApiResponse({ status: 200, description: 'Customers retrieved successfully' })
  async getCustomers(@Query() query: CustomerQueryDto) {
    const result = await this.customersService.getCustomers(query);
    return {
      statusCode: HttpStatus.OK,
      message: 'Customers retrieved successfully',
      ...result,
    };
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get customer statistics' })
  @ApiResponse({ status: 200, description: 'Stats retrieved successfully' })
  async getCustomerStats(): Promise<{
    statusCode: number;
    message: string;
    data: CustomerStatsDto;
  }> {
    const stats = await this.customersService.getCustomerStats();
    return {
      statusCode: HttpStatus.OK,
      message: 'Stats retrieved successfully',
      data: stats,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get customer by ID' })
  @ApiResponse({ status: 200, description: 'Customer retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Customer not found' })
  async getCustomerById(@Param('id') id: string) {
    const customer = await this.customersService.getCustomerById(+id);
    return {
      statusCode: HttpStatus.OK,
      message: 'Customer retrieved successfully',
      data: customer,
    };
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update customer' })
  @ApiResponse({ status: 200, description: 'Customer updated successfully' })
  @ApiResponse({ status: 404, description: 'Customer not found' })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  async updateCustomer(
    @Param('id') id: string,
    @Body() updateCustomerDto: UpdateCustomerDto,
  ) {
    const customer = await this.customersService.updateCustomer(
      +id,
      updateCustomerDto,
    );
    return {
      statusCode: HttpStatus.OK,
      message: 'Customer updated successfully',
      data: customer,
    };
  }

  @Patch(':id/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change customer status' })
  @ApiResponse({
    status: 200,
    description: 'Customer status changed successfully',
  })
  @ApiResponse({ status: 404, description: 'Customer not found' })
  @ApiResponse({ status: 400, description: 'Bad Request' })
  async changeCustomerStatus(
    @Param('id') id: string,
    @Body() changeStatusDto: ChangeCustomerStatusDto,
  ) {
    const customer = await this.customersService.changeCustomerStatus(
      +id,
      changeStatusDto,
    );
    return {
      statusCode: HttpStatus.OK,
      message: 'Customer status changed successfully',
      data: customer,
    };
  }

  @Get('debug')
  @Public()
  @ApiOperation({
    summary: 'Debug endpoint - Get all users without role filter',
  })
  @ApiResponse({
    status: 200,
    description: 'Debug data retrieved successfully',
  })
  async debugUsers() {
    try {
      console.log('DEBUG: Starting debug endpoint...');

      // Simple query without complex filters
      const allUsers = await this.customersService.debugGetAllUsers();

      console.log('DEBUG: Debug completed successfully');

      return {
        statusCode: HttpStatus.OK,
        message: 'Debug data retrieved successfully',
        data: allUsers,
      };
    } catch (error) {
      console.error('DEBUG: Error in debug endpoint:', error);
      return {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Debug endpoint failed',
        error: error.message,
      };
    }
  }

  @Get('debug-simple')
  @Public()
  @ApiOperation({
    summary: 'Simple debug endpoint - Test basic functionality',
  })
  @ApiResponse({
    status: 200,
    description: 'Simple debug test',
  })
  async debugSimple() {
    try {
      console.log('DEBUG SIMPLE: Starting simple debug...');

      // Very simple query - just count users
      const userCount = await this.prisma.users.count();

      console.log('DEBUG SIMPLE: Total users in database:', userCount);

      return {
        statusCode: HttpStatus.OK,
        message: 'Simple debug completed',
        data: {
          total_users: userCount,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error) {
      console.error('DEBUG SIMPLE: Error:', error);
      return {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Simple debug failed',
        error: error.message,
      };
    }
  }
}
