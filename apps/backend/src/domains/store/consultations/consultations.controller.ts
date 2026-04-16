import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { ConsultationsService } from './consultations.service';
import { SaveConsultationNotesDto } from './dto/save-consultation-notes.dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';

@Controller('store/consultations')
@UseGuards(PermissionsGuard)
export class ConsultationsController {
  constructor(
    private readonly consultationsService: ConsultationsService,
    private readonly responseService: ResponseService,
  ) {}

  @Permissions('store:reservations:read')
  @Get()
  async getToday(@Query('date') date?: string) {
    const result = await this.consultationsService.getTodayConsultations(date);
    return this.responseService.success(result);
  }

  @Permissions('store:reservations:read')
  @Get(':bookingId')
  async getContext(@Param('bookingId', ParseIntPipe) bookingId: number) {
    const result = await this.consultationsService.getConsultationContext(bookingId);
    return this.responseService.success(result);
  }

  @Permissions('store:reservations:write')
  @Post(':bookingId/notes')
  async saveNotes(
    @Param('bookingId', ParseIntPipe) bookingId: number,
    @Body() dto: SaveConsultationNotesDto,
  ) {
    const result = await this.consultationsService.saveConsultationNotes(bookingId, dto.notes);
    return this.responseService.success(result, 'Notas guardadas');
  }

  @Permissions('store:reservations:write')
  @Post(':bookingId/responses')
  async saveResponses(
    @Param('bookingId', ParseIntPipe) bookingId: number,
    @Body() body: { responses: any[] },
  ) {
    const result = await this.consultationsService.saveProviderResponses(bookingId, body.responses);
    return this.responseService.success(result, 'Respuestas guardadas');
  }

  @Permissions('store:reservations:write')
  @Patch(':bookingId/check-in')
  async checkIn(@Param('bookingId', ParseIntPipe) bookingId: number) {
    const result = await this.consultationsService.checkIn(bookingId);
    return this.responseService.success(result, 'Check-in realizado');
  }

  @Permissions('store:reservations:write')
  @Patch(':bookingId/start')
  async start(@Param('bookingId', ParseIntPipe) bookingId: number) {
    const result = await this.consultationsService.startConsultation(bookingId);
    return this.responseService.success(result, 'Consulta iniciada');
  }

  @Permissions('store:reservations:write')
  @Patch(':bookingId/complete')
  async complete(@Param('bookingId', ParseIntPipe) bookingId: number) {
    const result = await this.consultationsService.completeConsultation(bookingId);
    return this.responseService.success(result, 'Consulta completada');
  }
}
