import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Public } from '@common/decorators/public.decorator';
import { RECEIPT_MAX_BYTES, PaymentRequestsPublicService } from './payment-requests-public.service';
import { StartWompiDto, SubmitTransferDto } from './dto/payment-requests-public.dto';

/**
 * Public payment page (S15 / S3). The store comes from the storefront domain;
 * the unguessable token is the only credential. Never cached.
 */
@Controller('ecommerce/payment-requests')
@Public()
export class PaymentRequestsPublicController {
  constructor(private readonly service: PaymentRequestsPublicService) {}

  @Get(':token')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  async get(@Param('token') token: string) {
    return { success: true, data: await this.service.get(token) };
  }

  @Post(':token/wompi')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  async wompi(@Param('token') token: string, @Body() dto: StartWompiDto) {
    return { success: true, data: await this.service.startWompi(token, dto) };
  }

  @Post(':token/transfer')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: RECEIPT_MAX_BYTES } }))
  async transfer(
    @Param('token') token: string,
    @Body() dto: SubmitTransferDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return { success: true, data: await this.service.submitTransfer(token, file, dto) };
  }
}
