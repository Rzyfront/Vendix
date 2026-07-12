import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Header,
  BadRequestException,
} from '@nestjs/common';
import { CustomerQueueService } from '../../store/customer-queue/customer-queue.service';
import { CreateQueueEntryDto } from '../../store/customer-queue/dto/create-queue-entry.dto';
import { SearchQueueEntryDto } from '../../store/customer-queue/dto/search-queue-entry.dto';
import { Public } from '@common/decorators/public.decorator';
import { RequestContextService } from '@common/context/request-context.service';
import { ResponseService } from '@common/responses/response.service';

@Controller('ecommerce/customer-queue')
export class EcommerceCustomerQueueController {
  constructor(
    private readonly queueService: CustomerQueueService,
    private readonly responseService: ResponseService,
  ) {}

  @Public()
  @Post('register')
  @Header('Cache-Control', 'no-store')
  async register(@Body() dto: CreateQueueEntryDto) {
    const context = RequestContextService.getContext();
    const storeId = context?.store_id;
    if (!storeId) {
      throw new BadRequestException('Store context required');
    }

    const entry = await this.queueService.addToQueue(storeId, dto);
    return this.responseService.success({
      token: entry.token,
      position: entry.position,
      message: `Registrado en posición #${entry.position}`,
    });
  }

  @Public()
  @Get('status/:token')
  @Header('Cache-Control', 'no-store')
  async getStatus(@Param('token') token: string) {
    const entry = await this.queueService.getEntryByToken(token);
    return this.responseService.success({
      status: entry.status,
      position: entry.current_position,
      first_name: entry.first_name,
    });
  }

  @Public()
  @Post('search')
  @Header('Cache-Control', 'no-store')
  async search(@Body() dto: SearchQueueEntryDto) {
    const context = RequestContextService.getContext();
    const storeId = context?.store_id;
    if (!storeId) {
      throw new BadRequestException('Store context required');
    }

    try {
      const entry = await this.queueService.findByDocument(
        storeId,
        dto.document_type,
        dto.document_number,
      );
      return this.responseService.success({
        found: true,
        position: entry.current_position,
        status: entry.status,
        first_name: entry.first_name,
      });
    } catch (error: any) {
      if (error?.message === 'QUEUE_ENTRY_NOT_FOUND') {
        return this.responseService.success({
          found: false,
          message: 'No active queue entry found for this document',
        });
      }
      throw error;
    }
  }
}
