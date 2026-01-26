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

@Controller('auth/legal-acceptances')
@UseGuards(JwtAuthGuard)
export class LegalAcceptancesController {
  constructor(
    private readonly legalAcceptancesService: LegalAcceptancesService,
  ) {}

  @Get('pending')
  async getPendingTerms(@Request() req) {
    return this.legalAcceptancesService.getPendingTermsForUser(req.user.id);
  }

  @Get('my-acceptances')
  async getMyAcceptances(@Request() req) {
    return this.legalAcceptancesService.getUserAcceptanceHistory(req.user.id);
  }

  @Get('check-required')
  async checkRequiredAcceptances(@Request() req) {
    return this.legalAcceptancesService.checkRequiredAcceptances(
      req.user.id,
    );
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
      return {
        success: false,
        message: 'Acceptance is required',
      };
    }

    return this.legalAcceptancesService.acceptDocument(req.user.id, documentId, {
      ip,
      userAgent,
      context: dto.context || 'dashboard',
    });
  }
}
