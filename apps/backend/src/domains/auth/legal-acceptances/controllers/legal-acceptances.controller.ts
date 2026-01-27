import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  Request,
  Ip,
  Headers,
  ParseIntPipe,
  Body,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard';
import { LegalAcceptancesService } from '../services/legal-acceptances.service';
import { AcceptDocumentDto } from '../dto/accept-document.dto';
import { ResponseService } from '../../../../common/responses/response.service';

@Controller('auth/legal-acceptances')
@UseGuards(JwtAuthGuard)
export class LegalAcceptancesController {
  constructor(
    private readonly legalAcceptancesService: LegalAcceptancesService,
    private readonly responseService: ResponseService,
  ) {}

  @Get('pending')
  async getPendingTerms(@Request() req) {
    const data = await this.legalAcceptancesService.getPendingTermsForUser(
      req.user.id,
    );
    return this.responseService.success(data);
  }

  @Get('my-acceptances')
  async getMyAcceptances(@Request() req) {
    const data = await this.legalAcceptancesService.getUserAcceptanceHistory(
      req.user.id,
    );
    return this.responseService.success(data);
  }

  @Get('check-required')
  async checkRequiredAcceptances(@Request() req) {
    const data = await this.legalAcceptancesService.checkRequiredAcceptances(
      req.user.id,
    );
    return this.responseService.success({
      pending: data.length > 0,
      documents: data,
    });
  }

  @Post(':documentId/accept')
  async acceptDocument(
    @Request() req,
    @Param('documentId', ParseIntPipe) documentId: number,
    @Body() dto: AcceptDocumentDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    if (!dto.accepted) {
      return this.responseService.error('Acceptance is required');
    }

    const result = await this.legalAcceptancesService.acceptDocument(
      req.user.id,
      documentId,
      {
        ip,
        userAgent,
        context: dto.context || 'dashboard',
      },
    );

    return this.responseService.success(
      result,
      'Document accepted successfully',
    );
  }
}
