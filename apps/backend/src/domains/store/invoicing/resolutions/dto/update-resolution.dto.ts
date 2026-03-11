import { PartialType } from '@nestjs/mapped-types';
import { CreateResolutionDto } from './create-resolution.dto';

export class UpdateResolutionDto extends PartialType(CreateResolutionDto) {}
