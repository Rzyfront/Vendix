import {
  IsString,
  IsBoolean,
  IsNumber,
  Min,
  Max,
  IsEnum,
  IsArray,
  IsOptional,
  IsObject,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

// ============================================================================
// DTOs for Standard Carriers (FedEx, DHL, UPS, etc.)
// ============================================================================

export class MaxDimensionsDto {
  @ApiProperty({ example: 100 })
  @IsNumber()
  @Min(0)
  length: number;

  @ApiProperty({ example: 50 })
  @IsNumber()
  @Min(0)
  width: number;

  @ApiProperty({ example: 30 })
  @IsNumber()
  @Min(0)
  height: number;
}

export class CarrierConfigDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  tracking_enabled: boolean;

  @ApiProperty({ example: 3 })
  @IsNumber()
  @Min(0)
  estimated_days_min: number;

  @ApiProperty({ example: 7 })
  @IsNumber()
  @Min(0)
  estimated_days_max: number;

  @ApiProperty({ example: false })
  @IsBoolean()
  requires_signature: boolean;

  @ApiProperty({ example: false })
  @IsBoolean()
  requires_insurance: boolean;

  @ApiProperty({ example: null, required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  max_weight?: number | null;

  @ApiProperty({ type: MaxDimensionsDto, required: false })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => MaxDimensionsDto)
  max_dimensions?: MaxDimensionsDto | null;
}

export class StandardCarrierDto {
  @ApiProperty({ example: 'carrier-1' })
  @IsString()
  id: string;

  @ApiProperty({ example: 'FedEx' })
  @IsString()
  name: string;

  @ApiProperty({
    enum: ['fedex', 'dhl', 'ups', 'correos', 'estafeta', 'custom'],
    example: 'fedex',
  })
  @IsEnum(['fedex', 'dhl', 'ups', 'correos', 'estafeta', 'custom'])
  type: 'fedex' | 'dhl' | 'ups' | 'correos' | 'estafeta' | 'custom';

  @ApiProperty({ example: true })
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({ type: CarrierConfigDto })
  @IsObject()
  @ValidateNested()
  @Type(() => CarrierConfigDto)
  config: CarrierConfigDto;
}

// ============================================================================
// DTOs for Express Carriers (Servientrega, Rappi, Didi, etc.)
// ============================================================================

export class ExpressCarrierConfigDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  integration_enabled: boolean;

  @ApiProperty({ example: 1 })
  @IsNumber()
  @Min(1)
  priority: number;

  @ApiProperty({ example: true })
  @IsBoolean()
  tracking_enabled: boolean;

  @ApiProperty({ example: 'https://webhook.example.com', required: false })
  @IsOptional()
  @IsString()
  webhook_url?: string | null;
}

export class ExpressCarrierDto {
  @ApiProperty({ example: 'express-1' })
  @IsString()
  id: string;

  @ApiProperty({ example: 'Servientrega' })
  @IsString()
  name: string;

  @ApiProperty({
    enum: ['servientrega', 'rappi', 'didi', 'uber_direct', 'custom'],
    example: 'servientrega',
  })
  @IsEnum(['servientrega', 'rappi', 'didi', 'uber_direct', 'custom'])
  type: 'servientrega' | 'rappi' | 'didi' | 'uber_direct' | 'custom';

  @ApiProperty({ example: true })
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({ type: ExpressCarrierConfigDto })
  @IsObject()
  @ValidateNested()
  @Type(() => ExpressCarrierConfigDto)
  config: ExpressCarrierConfigDto;
}

// ============================================================================
// DTOs for Local Delivery Providers
// ============================================================================

export class LocalDeliveryConfigDto {
  @ApiProperty({ example: 10, required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  coverage_radius?: number | null;

  @ApiProperty({ example: 45, required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  estimated_minutes?: number | null;

  @ApiProperty({ example: true })
  @IsBoolean()
  tracking_enabled: boolean;
}

export class LocalDeliveryProviderDto {
  @ApiProperty({ example: 'local-1' })
  @IsString()
  id: string;

  @ApiProperty({ example: 'Deliveri' })
  @IsString()
  name: string;

  @ApiProperty({
    enum: ['deliveri', 'mensajeros', 'motocicletas', 'custom'],
    example: 'deliveri',
  })
  @IsEnum(['deliveri', 'mensajeros', 'motocicletas', 'custom'])
  type: 'deliveri' | 'mensajeros' | 'motocicletas' | 'custom';

  @ApiProperty({ example: true })
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({ type: LocalDeliveryConfigDto })
  @IsObject()
  @ValidateNested()
  @Type(() => LocalDeliveryConfigDto)
  config: LocalDeliveryConfigDto;
}

// ============================================================================
// DTOs for Shipping Types Configuration
// ============================================================================

export class ShippingStandardConfigDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({ type: [StandardCarrierDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StandardCarrierDto)
  carriers: StandardCarrierDto[];
}

export class ShippingExpressConfigDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({ type: [ExpressCarrierDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExpressCarrierDto)
  carriers: ExpressCarrierDto[];
}

export class ShippingLocalConfigDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({ example: true })
  @IsBoolean()
  allow_manual: boolean;

  @ApiProperty({ type: [LocalDeliveryProviderDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LocalDeliveryProviderDto)
  delivery_providers: LocalDeliveryProviderDto[];
}

export class ShippingTypesConfigDto {
  @ApiProperty({ type: ShippingStandardConfigDto })
  @IsObject()
  @ValidateNested()
  @Type(() => ShippingStandardConfigDto)
  standard: ShippingStandardConfigDto;

  @ApiProperty({ type: ShippingExpressConfigDto })
  @IsObject()
  @ValidateNested()
  @Type(() => ShippingExpressConfigDto)
  express: ShippingExpressConfigDto;

  @ApiProperty({ type: ShippingLocalConfigDto })
  @IsObject()
  @ValidateNested()
  @Type(() => ShippingLocalConfigDto)
  local: ShippingLocalConfigDto;
}

// ============================================================================
// DTOs for Shipping Zones and Rules
// ============================================================================

export class ShippingRuleDto {
  @ApiProperty({ example: 'carrier-1' })
  @IsString()
  carrier_id: string;

  @ApiProperty({ example: 15.5 })
  @IsNumber()
  @Min(0)
  base_price: number;

  @ApiProperty({ example: 2.5 })
  @IsNumber()
  @Min(0)
  price_per_kg: number;

  @ApiProperty({ example: 100, required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  free_shipping_threshold?: number | null;

  @ApiProperty({ example: 5 })
  @IsNumber()
  @Min(0)
  estimated_days: number;
}

export class ShippingZoneDto {
  @ApiProperty({ example: 'zone-1' })
  @IsString()
  id: string;

  @ApiProperty({ example: 'Zona Norte' })
  @IsString()
  name: string;

  @ApiProperty({ example: ['Colombia'], type: [String] })
  @IsArray()
  @IsString({ each: true })
  countries: string[];

  @ApiProperty({ example: ['Antioquia', 'Cundinamarca'], type: [String] })
  @IsArray()
  @IsString({ each: true })
  states: string[];

  @ApiProperty({ example: ['Medellín', 'Bogotá'], type: [String] })
  @IsArray()
  @IsString({ each: true })
  cities: string[];

  @ApiProperty({ example: ['050010', '110010'], type: [String] })
  @IsArray()
  @IsString({ each: true })
  zip_codes: string[];

  @ApiProperty({ type: [ShippingRuleDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShippingRuleDto)
  shipping_rules: ShippingRuleDto[];
}
