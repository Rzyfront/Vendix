import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PaymentLinksService } from './payment-links.service';
import { CreatePaymentLinkDto } from './dto/create-payment-link.dto';
import { PaymentLinkQueryDto } from './dto/payment-link-query.dto';

@ApiTags('Payment Links')
@Controller('store/payment-links')
@UseGuards(JwtAuthGuard)
export class PaymentLinksController {
  constructor(private readonly paymentLinksService: PaymentLinksService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new payment link' })
  async create(@Body() dto: CreatePaymentLinkDto) {
    return this.paymentLinksService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all payment links' })
  async findAll(@Query() query: PaymentLinkQueryDto) {
    return this.paymentLinksService.findAll(query);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get payment link statistics' })
  async getStats() {
    return this.paymentLinksService.getStats();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a payment link by ID' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.paymentLinksService.findOne(id);
  }

  @Patch(':id/deactivate')
  @ApiOperation({ summary: 'Deactivate a payment link' })
  async deactivate(@Param('id', ParseIntPipe) id: number) {
    return this.paymentLinksService.deactivate(id);
  }
}
