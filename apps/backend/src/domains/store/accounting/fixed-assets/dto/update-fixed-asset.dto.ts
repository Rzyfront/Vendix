import { PartialType } from '@nestjs/mapped-types';
import { CreateFixedAssetDto } from './create-fixed-asset.dto';

export class UpdateFixedAssetDto extends PartialType(CreateFixedAssetDto) {}
