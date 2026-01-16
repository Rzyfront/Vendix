import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
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
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { Roles } from '../../../auth/decorators/roles.decorator';
import { UserRole } from '../../../auth/enums/user-role.enum';
import { PaymentMethodsService } from '../services/payment-methods.service';
import { CreatePaymentMethodDto, UpdatePaymentMethodDto } from '../dto';

@ApiTags('Admin Payment Methods')
@Controller('admin/payment-methods')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
@ApiBearerAuth()
export class PaymentMethodsController {
  constructor(private readonly paymentMethodsService: PaymentMethodsService) { }

  @Post()
  @ApiOperation({ summary: 'Create a new payment method' })
  @ApiResponse({
    status: 201,
    description: 'Payment method created successfully',
  })
  @ApiResponse({ status: 409, description: 'Payment method already exists' })
  async create(@Body() createDto: CreatePaymentMethodDto) {
    return this.paymentMethodsService.create(createDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all payment methods' })
  @ApiResponse({
    status: 200,
    description: 'Payment methods retrieved successfully',
  })
  async findAll() {
    return this.paymentMethodsService.findAll();
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get payment methods statistics' })
  @ApiResponse({
    status: 200,
    description: 'Payment methods statistics retrieved successfully',
  })
  async getStats() {
    return this.paymentMethodsService.getStats();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get payment method by ID' })
  @ApiResponse({
    status: 200,
    description: 'Payment method retrieved successfully',
  })
  @ApiResponse({ status: 404, description: 'Payment method not found' })
  async findOne(@Param('id') id: string) {
    return this.paymentMethodsService.findOne(parseInt(id));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update payment method' })
  @ApiResponse({
    status: 200,
    description: 'Payment method updated successfully',
  })
  @ApiResponse({ status: 404, description: 'Payment method not found' })
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdatePaymentMethodDto,
  ) {
    return this.paymentMethodsService.update(parseInt(id), updateDto);
  }

  @Patch(':id/toggle')
  @ApiOperation({ summary: 'Toggle payment method active status' })
  @ApiResponse({
    status: 200,
    description: 'Payment method status toggled successfully',
  })
  @ApiResponse({ status: 404, description: 'Payment method not found' })
  async toggleActive(@Param('id') id: string) {
    return this.paymentMethodsService.toggleActive(parseInt(id));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete payment method' })
  @ApiResponse({
    status: 200,
    description: 'Payment method deleted successfully',
  })
  @ApiResponse({ status: 400, description: 'Payment method is in use' })
  @ApiResponse({ status: 404, description: 'Payment method not found' })
  async remove(@Param('id') id: string) {
    return this.paymentMethodsService.remove(parseInt(id));
  }
}
