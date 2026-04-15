import { PartialType } from '@nestjs/mapped-types';
import { CreateMetadataFieldDto } from './create-metadata-field.dto';

export class UpdateMetadataFieldDto extends PartialType(CreateMetadataFieldDto) {}
