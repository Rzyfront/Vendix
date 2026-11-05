import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PaymentRequestQueryDto, RejectPaymentRequestDto } from './dto/payment-request.dto';
import { PaymentRequestsService } from './payment-requests.service';

/** Admin side of the payment page: review, confirm or reject transfer receipts. */
@Controller('store/payment-requests')
@UseGuards(PermissionsGuard)
export class PaymentRequestsController {
  constructor(private readonly service: PaymentRequestsService) {}

  @Permissions('store:payment_requests:read')
  @Get()
  list(@Query() query: PaymentRequestQueryDto) {
    return this.service.findAll(query);
  }

  @Permissions('store:payment_requests:read')
  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Permissions('store:payment_requests:manage')
  @Post(':id/cancel')
  cancel(@Param('id', ParseIntPipe) id: number) {
    return this.service.cancel(id);
  }

  @Permissions('store:payment_requests:manage')
  @Post(':id/confirm')
  confirm(@Param('id', ParseIntPipe) id: number) {
    return this.service.confirm(id);
  }

  @Permissions('store:payment_requests:manage')
  @Post(':id/reject')
  reject(@Param('id', ParseIntPipe) id: number, @Body() dto: RejectPaymentRequestDto) {
    return this.service.reject(id, dto.reason);
  }
}
