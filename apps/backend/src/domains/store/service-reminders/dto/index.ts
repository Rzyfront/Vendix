import { IsOptional, IsString, IsInt, Min, Max, IsIn, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ListServiceRemindersDto {
  @ApiPropertyOptional({
    description: 'Filtrar por estado del recordatorio (pending, sent, dismissed, all)',
    enum: ['pending', 'sent', 'dismissed', 'all'],
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Número de página (1-based)', default: 1 })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Cantidad de elementos por página', default: 20 })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Búsqueda por texto (nombre de cliente o servicio)' })
  @IsOptional()
  @IsString()
  search?: string;
}

export const SERVICE_REGISTRY_FILTERS = ['all', 'recurring', 'due_soon', 'overdue'] as const;
export type ServiceRegistryFilter = (typeof SERVICE_REGISTRY_FILTERS)[number];

export class ListServiceRegistryDto {
  @ApiPropertyOptional({
    description: 'all = todos; recurring = servicios recurrentes vigentes; due_soon = vencen en 0-3 días; overdue = ya vencidos',
    enum: SERVICE_REGISTRY_FILTERS,
    default: 'all',
  })
  @IsOptional()
  @IsIn(SERVICE_REGISTRY_FILTERS as unknown as string[])
  filter?: ServiceRegistryFilter = 'all';

  @ApiPropertyOptional({ description: 'Cliente, servicio, estación, vehículo/placa u orden' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

/** Identifica una fila del registro: (orden fuente, servicio). */
export class ServiceRegistryActionDto {
  @ApiProperty({ description: 'Orden del servicio (SVC-{id} en estaciones)' })
  @IsInt()
  @Type(() => Number)
  @Min(1)
  source_order_id: number;

  @ApiProperty({ description: 'Producto/servicio realizado' })
  @IsInt()
  @Type(() => Number)
  @Min(1)
  product_id: number;
}

/** WhatsApp de una fila; `phone` sirve cuando el cliente no tiene teléfono guardado. */
export class ServiceRegistryWhatsappDto extends ServiceRegistryActionDto {
  @ApiPropertyOptional({ description: 'Teléfono a usar (y guardar en el perfil) si no hay uno registrado' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;
}

/** Asigna un cliente registrado a una fila del registro que se atendió sin cliente. */
export class ServiceRegistryAssignCustomerDto extends ServiceRegistryActionDto {
  @ApiProperty({ description: 'Cliente registrado de la tienda' })
  @IsInt()
  @Type(() => Number)
  @Min(1)
  customer_id: number;
}
