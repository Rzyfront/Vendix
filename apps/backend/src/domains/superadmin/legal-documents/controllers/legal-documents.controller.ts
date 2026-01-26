import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
  ParseIntPipe,
} from '@nestjs/common';
import { Roles } from '../../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { UserRole } from '../../../auth/enums/user-role.enum';
import { LegalDocumentsService } from '../services/legal-documents.service';
import { CreateSystemDocumentDto } from '../dto/create-system-document.dto';
import { UpdateSystemDocumentDto } from '../dto/update-system-document.dto';

@Controller('superadmin/legal-documents')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class LegalDocumentsController {
  constructor(private readonly legalDocumentsService: LegalDocumentsService) {}

  @Get()
  async getSystemDocuments(@Query('document_type') documentType?: string) {
    const filters: any = {};
    if (documentType) {
      filters.document_type = documentType;
    }
    return this.legalDocumentsService.getSystemDocuments(filters);
  }

  @Get('active/:documentType')
  async getActiveDocument(@Param('documentType') documentType: string) {
    return this.legalDocumentsService.getActiveSystemDocument(
      documentType as any,
    );
  }

  @Get('history/:documentType')
  async getDocumentHistory(@Param('documentType') documentType: string) {
    return this.legalDocumentsService.getDocumentHistory(
      documentType as any,
    );
  }

  @Get('pending/:documentType')
  async getUsersPendingAcceptance(@Param('documentType') documentType: string) {
    return this.legalDocumentsService.getUsersPendingAcceptance(
      documentType as any,
    );
  }

  @Get(':id')
  async getSystemDocument(@Param('id', ParseIntPipe) id: number) {
    return this.legalDocumentsService.getSystemDocument(id);
  }

  @Get(':id/acceptances')
  async getDocumentAcceptances(
    @Param('id', ParseIntPipe) id: number,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('organizationId') organizationId?: string,
    @Query('userId') userId?: string,
  ) {
    const filters: any = {};
    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;
    if (organizationId) filters.organizationId = parseInt(organizationId);
    if (userId) filters.userId = parseInt(userId);

    return this.legalDocumentsService.getDocumentAcceptances(id, filters);
  }

  @Get(':id/stats')
  async getAcceptanceStats(@Param('id', ParseIntPipe) id: number) {
    return this.legalDocumentsService.getAcceptanceStats(id);
  }

  @Post()
  async createDocument(
    @Request() req,
    @Body() dto: CreateSystemDocumentDto,
  ) {
    return this.legalDocumentsService.createSystemDocument(
      req.user.id,
      dto,
    );
  }

  @Patch(':id')
  async updateDocument(
    @Param('id', ParseIntPipe) id: number,
    @Request() req,
    @Body() dto: UpdateSystemDocumentDto,
  ) {
    return this.legalDocumentsService.updateSystemDocument(
      id,
      req.user.id,
      dto,
    );
  }

  @Patch(':id/activate')
  async activateDocument(
    @Param('id', ParseIntPipe) id: number,
    @Request() req,
  ) {
    return this.legalDocumentsService.activateDocument(id, req.user.id);
  }

  @Patch(':id/deactivate')
  async deactivateDocument(
    @Param('id', ParseIntPipe) id: number,
    @Request() req,
  ) {
    return this.legalDocumentsService.deactivateDocument(id, req.user.id);
  }

  // TODO: Add PDF upload endpoint when S3 is configured
  // @Post(':id/upload-pdf')
  // @UseInterceptors(FileInterceptor('file'))
  // async uploadPDF(
  //   @Param('id', ParseIntPipe) id: number,
  //   @UploadedFile() file: Express.Multer.File,
  // ) {
  //   if (!file) {
  //     throw new BadRequestException('PDF file is required');
  //   }
  //   if (file.mimetype !== 'application/pdf') {
  //     throw new BadRequestException('Only PDF files are allowed');
  //   }
  //   const filename = `${Date.now()}-${file.originalname}`;
  //   return this.legalDocumentsService.uploadDocumentPDF(
  //     file.buffer,
  //     id,
  //     filename,
  //   );
  // }
}
