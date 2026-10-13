import { Transform, Type } from 'class-transformer';
import { Equals, IsBoolean, IsInt, IsString, MaxLength, Min, MinLength } from 'class-validator';

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
