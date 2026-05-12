import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Create payload for org-level supplier writes.
 *
 * `organization_id` is intentionally absent — it is always derived from the
 * authenticated `RequestContext`. Callers cannot create suppliers in another
 * organization through this endpoint.
 *
 * `store_id` is OPTIONAL:
 *   - omitted / null → org-shared supplier (visible to every store of the org).
 *   - provided → store-scoped supplier; the service validates that the store
 *     belongs to the caller's organization.
 */
export class CreateOrgSupplierDto {
  @ApiPropertyOptional({
    description:
      'Owning store id. Omit for an org-shared supplier (store_id = null).',
  })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  store_id?: number | null;

  @ApiProperty({ description: 'Supplier name' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'Supplier code' })
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiPropertyOptional({ description: 'Contact person name' })
  @IsOptional()
  @IsString()
  contact_person?: string;

  @ApiPropertyOptional({ description: 'Email address' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ description: 'Phone number' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ description: 'Mobile phone number' })
  @IsOptional()
  @IsString()
  mobile?: string;

  @ApiPropertyOptional({ description: 'Website URL' })
  @IsOptional()
  @IsString()
  website?: string;

  @ApiPropertyOptional({ description: 'Tax ID or VAT number' })
  @IsOptional()
  @IsString()
  tax_id?: string;

  @ApiPropertyOptional({ description: 'Tax regime' })
  @IsOptional()
  @IsString()
  tax_regime?: string;

  @ApiPropertyOptional({ description: 'Document type' })
  @IsOptional()
  @IsString()
  document_type?: string;

  @ApiPropertyOptional({ description: 'Verification digit' })
  @IsOptional()
  @IsString()
  verification_digit?: string;

  @ApiPropertyOptional({ description: 'Payment terms (e.g., NET30, NET60)' })
  @IsOptional()
  @IsString()
  payment_terms?: string;

  @ApiPropertyOptional({ description: 'Currency code' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ description: 'Lead time in days' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  lead_time_days?: number;

  @ApiPropertyOptional({ description: 'Notes about the supplier' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: 'Address ID associated with supplier' })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  address_id?: number;

  @ApiPropertyOptional({ description: 'Is supplier active', default: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
