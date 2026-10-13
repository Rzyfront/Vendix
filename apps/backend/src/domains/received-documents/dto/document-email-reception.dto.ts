import { Transform, Type } from 'class-transformer';
import { Equals, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

/** No scope override is accepted, including on GET requests. */
export class DocumentEmailEmptyQueryDto {}

export class ActivateDocumentEmailInboxDto {
  @Transform(({ obj, key }) => obj[key])
  @IsBoolean()
  @Equals(true)
  consent!: boolean;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  policy_version!: string;
}

export class UpdateDocumentEmailInboxDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expected_version!: number;

  @Transform(({ obj, key }) => obj[key])
  @IsBoolean()
  enabled!: boolean;
}

export class RotateDocumentEmailAddressDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expected_version!: number;

  @Transform(({ obj, key }) => obj[key])
  @IsBoolean()
  @Equals(true)
  confirmed!: boolean;
}

export class DocumentEmailMessagesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 25;

  @IsOptional()
  @IsIn(['history', 'not_processed'])
  view: 'history' | 'not_processed' = 'history';

  @IsOptional()
  @Transform(({ obj, key }) => obj[key] === 'true' ? true : obj[key] === 'false' ? false : obj[key])
  @IsBoolean()
  archived: boolean = false;
}

export class DocumentEmailMessageVersionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expected_version!: number;
}

export class DiscardDocumentEmailMessageDto extends DocumentEmailMessageVersionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  reason?: string;
}
