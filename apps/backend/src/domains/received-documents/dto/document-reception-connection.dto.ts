import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min, ValidateIf } from 'class-validator';
import { DocumentReceptionConnectionType } from '../interfaces/document-reception-connection.interface';

const CONNECTION_TYPES: DocumentReceptionConnectionType[] = ['api_poll', 'webhook'];
const NO_CONTROL_CHARACTERS = /^[^\x00-\x1f\x7f]+$/;

export class CreateDocumentReceptionConnectionDto {
  @Transform(({ obj, key }) => {
    const value = obj[key];
    return typeof value === 'string' ? value.trim() : value;
  })
  @IsString()
  @Length(1, 100)
  name!: string;

  @IsIn(CONNECTION_TYPES)
  connection_type!: DocumentReceptionConnectionType;

  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ obj, key }) => obj[key])
  @IsBoolean()
  enabled = false;

  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ obj, key }) => obj[key])
  @IsString()
  @Length(1, 2048)
  @Matches(NO_CONTROL_CHARACTERS)
  endpoint?: string;

  /** Write-only HMAC/bearer secret; public hook tokens are not authorization. */
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ obj, key }) => obj[key])
  @IsString()
  @Length(1, 4096)
  @Matches(NO_CONTROL_CHARACTERS)
  secret?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  poll_interval_minutes = 15;
}

export class UpdateDocumentReceptionConnectionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expected_version!: number;

  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ obj, key }) => {
    const value = obj[key];
    return typeof value === 'string' ? value.trim() : value;
  })
  @IsString()
  @Length(1, 100)
  name?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ obj, key }) => obj[key])
  @IsBoolean()
  enabled?: boolean;

  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ obj, key }) => obj[key])
  @IsString()
  @Length(1, 2048)
  @Matches(NO_CONTROL_CHARACTERS)
  endpoint?: string;

  /** A nonempty value rotates the credential; null/empty never clears the stored secret. */
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(({ obj, key }) => obj[key])
  @IsString()
  @Length(1, 4096)
  @Matches(NO_CONTROL_CHARACTERS)
  secret?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  poll_interval_minutes?: number;
}

export class DocumentReceptionConnectionQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 25;
}
