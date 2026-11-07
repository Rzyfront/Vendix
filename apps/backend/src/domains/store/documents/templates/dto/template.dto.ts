import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateTemplateDto {
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9_-]{1,79}$/, {
    message: 'La clave usa minúsculas, números, "-" o "_" (2 a 80 caracteres).',
  })
  key!: string;

  @IsString() @MinLength(2) @MaxLength(160) name!: string;
  @IsOptional() @IsString() @MaxLength(40) category?: string;
  @IsIn(['blocks', 'base_pdf']) kind!: 'blocks' | 'base_pdf';
}

export class UpdateTemplateDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(160) name?: string;
  @IsOptional() @IsString() @MaxLength(40) category?: string;
  /** Block body or base-PDF body; validated against the template kind. */
  @IsOptional() @IsObject() body?: Record<string, unknown>;
}

export class TemplatesQueryDto {
  @IsOptional() @IsIn(['draft', 'published', 'archived']) status?: 'draft' | 'published' | 'archived';
  @IsOptional() @IsIn(['blocks', 'base_pdf']) kind?: 'blocks' | 'base_pdf';
  @IsOptional() @IsString() @MaxLength(100) search?: string;
}

export class EmitDocumentDto {
  @Type(() => Number) @IsInt() instance_id!: number;
  @IsOptional() @IsString() @MaxLength(80) template_key?: string;
  @IsOptional() @IsString() @MaxLength(80) requirement_key?: string;
  @IsOptional() @IsString() @MaxLength(200) title?: string;
}

export class VoidDocumentDto {
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}

export class IssuedQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() instance_id?: number;
  @IsOptional() @Type(() => Number) @IsInt() dossier_id?: number;
  @IsOptional() @IsString() @MaxLength(30) status?: string;
}
