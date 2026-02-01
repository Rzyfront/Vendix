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
import { Roles } from '../../../../domains/auth/decorators/roles.decorator';
import { RolesGuard } from '../../../../domains/auth/guards/roles.guard';
import { UserRole } from '../../../../domains/auth/enums/user-role.enum';
import { StoreLegalDocumentsService } from '../services/store-legal-documents.service';
import { CreateStoreDocumentDto } from '../dto/create-store-document.dto';
import { UpdateStoreDocumentDto } from '../dto/update-store-document.dto';
import { ResponseService } from '../../../../common/responses/response.service';

@Controller('store/legal-documents')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.OWNER, UserRole.ADMIN)
export class StoreLegalDocumentsController {
    constructor(
        private readonly storeLegalDocumentsService: StoreLegalDocumentsService,
        private readonly responseService: ResponseService,
    ) { }

    @Get()
    async getDocuments(
        @Query('document_type') documentType?: string,
        @Query('is_active') isActive?: string,
        @Query('search') search?: string,
    ) {
        const filters: any = {};
        if (documentType) filters.document_type = documentType;
        if (isActive !== undefined) filters.is_active = isActive === 'true';
        if (search) filters.search = search;

        const data = await this.storeLegalDocumentsService.getDocuments(filters);
        return this.responseService.success(data);
    }

    @Get(':id')
    async getDocument(@Param('id', ParseIntPipe) id: number) {
        const data = await this.storeLegalDocumentsService.getDocument(id);
        return this.responseService.success(data);
    }

    @Post()
    async createDocument(@Request() req, @Body() dto: CreateStoreDocumentDto) {
        const data = await this.storeLegalDocumentsService.createDocument(
            req.user.id,
            dto,
        );
        return this.responseService.success(data, 'Document created successfully');
    }

    @Patch(':id')
    async updateDocument(
        @Param('id', ParseIntPipe) id: number,
        @Request() req,
        @Body() dto: UpdateStoreDocumentDto,
    ) {
        const data = await this.storeLegalDocumentsService.updateDocument(
            id,
            req.user.id,
            dto,
        );
        return this.responseService.success(data, 'Document updated successfully');
    }

    @Patch(':id/activate')
    async activateDocument(
        @Param('id', ParseIntPipe) id: number,
        @Request() req,
    ) {
        const data = await this.storeLegalDocumentsService.activateDocument(
            id,
            req.user.id,
        );
        return this.responseService.success(
            data,
            'Document activated successfully',
        );
    }

    @Patch(':id/deactivate')
    async deactivateDocument(
        @Param('id', ParseIntPipe) id: number,
        @Request() req,
    ) {
        const data = await this.storeLegalDocumentsService.deactivateDocument(
            id,
            req.user.id,
        );
        return this.responseService.success(
            data,
            'Document deactivated successfully',
        );
    }

    @Delete(':id')
    async deleteDocument(
        @Param('id', ParseIntPipe) id: number,
        @Request() req,
    ) {
        const data = await this.storeLegalDocumentsService.deleteDocument(
            id,
            req.user.id,
        );
        return this.responseService.success(data, 'Document deleted successfully');
    }
}
