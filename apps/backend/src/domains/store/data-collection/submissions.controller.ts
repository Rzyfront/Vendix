import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  ParseIntPipe,
  UseGuards,
  Sse,
} from '@nestjs/common';
import { SubmissionsService } from './submissions.service';
import { CreateSubmissionDto } from './dto/create-submission.dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';
import { Observable } from 'rxjs';

@Controller('store/data-collection/submissions')
@UseGuards(PermissionsGuard)
export class SubmissionsController {
  constructor(
    private readonly service: SubmissionsService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:reservations:read')
  async findAll(@Query('status') status?: string) {
    const result = await this.service.findByStore(status);
    return this.responseService.success(result);
  }

  @Get(':id')
  @Permissions('store:reservations:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const result = await this.service.findOne(id);
    return this.responseService.success(result);
  }

  @Get('booking/:bookingId')
  @Permissions('store:reservations:read')
  async findByBooking(@Param('bookingId', ParseIntPipe) bookingId: number) {
    const result = await this.service.getSubmissionByBooking(bookingId);
    return this.responseService.success(result);
  }

  @Post()
  @Permissions('store:reservations:write')
  async create(@Body() dto: CreateSubmissionDto) {
    const result = await this.service.createSubmission(dto);
    return this.responseService.success(
      result,
      'Formulario creado correctamente',
    );
  }

  @Sse(':id/prediagnosis/stream')
  @Permissions('store:reservations:read')
  streamPrediagnosis(
    @Param('id', ParseIntPipe) id: number,
  ): Observable<MessageEvent> {
    return this.service.streamPrediagnosis(id);
  }
}
