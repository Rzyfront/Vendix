import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  Equals,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CreateVexiPublicSessionDto {
  /** The visitor accepted the data-processing notice shown before the first message. */
  @IsBoolean()
  @Equals(true, { message: 'Debes aceptar el aviso de tratamiento de datos.' })
  consent!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  app_type?: string;
}

export class VexiPublicCartLineDto {
  @IsInt()
  @Min(1)
  product_id!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  variant_id?: number;

  @IsInt()
  @Min(1)
  @Max(999)
  quantity!: number;
}

/**
 * Where the visitor is. UNTRUSTED: the server re-reads every id against the
 * store's public catalog and only passes names it verified to the model.
 */
export class VexiPublicContextDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  app_type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  route?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  product_id?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => VexiPublicCartLineDto)
  cart?: VexiPublicCartLineDto[];
}

export class VexiPublicMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  message!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => VexiPublicContextDto)
  context?: VexiPublicContextDto;
}
