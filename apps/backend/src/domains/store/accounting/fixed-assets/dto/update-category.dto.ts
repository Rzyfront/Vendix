import { PartialType } from '@nestjs/mapped-types';
import { CreateFixedAssetCategoryDto } from './create-category.dto';

export class UpdateFixedAssetCategoryDto extends PartialType(CreateFixedAssetCategoryDto) {}
