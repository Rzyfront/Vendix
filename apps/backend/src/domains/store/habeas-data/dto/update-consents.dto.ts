import { IsArray, ValidateNested, IsEnum, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';

enum ConsentTypeEnum {
  MARKETING = 'marketing',
  ANALYTICS = 'analytics',
  THIRD_PARTY = 'third_party',
  PROFILING = 'profiling',
}

class ConsentItemDto {
  @IsEnum(ConsentTypeEnum)
  consent_type: ConsentTypeEnum;

  @IsBoolean()
  granted: boolean;
}

export class UpdateConsentsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConsentItemDto)
  consents: ConsentItemDto[];
}
