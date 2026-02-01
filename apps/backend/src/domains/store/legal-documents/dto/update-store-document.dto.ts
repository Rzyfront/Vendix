import { PartialType } from '@nestjs/mapped-types';
import { CreateStoreDocumentDto, StoreLegalDocumentTypeEnum } from './create-store-document.dto';

export class UpdateStoreDocumentDto extends PartialType(CreateStoreDocumentDto) {
    title?: string;
    version?: string;
    content?: string;
    description?: string;
    effective_date?: string;
    expiry_date?: string;
    document_url?: string;
    document_type?: StoreLegalDocumentTypeEnum;
}
