import {
  IsInt,
  IsOptional,
  IsArray,
  ValidateNested,
  IsBoolean,
  IsString,
  IsIn,
  ArrayMaxSize,
  ArrayMinSize,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { RouteAssignmentDto, CreateFromOrderItemDto } from './create-from-order.dto';

/**
 * Plan Despacho Economía — FASE 7 paso 23.
 * Crea remisiones en lote para N órdenes con resultado parcial por orden.
 *
 * Reglas de tamaño:
 *  - `orders` debe tener entre 1 y 100 elementos (backend rechaza con
 *    DSP_BATCH_EMPTY_001 / DSP_BATCH_TOO_LARGE_001).
 *  - `items_by_order` (opcional) sobreescribe los ítems a despachar por
 *    orden; si se omite, el backend asume "todo lo pendiente" (quick-accept).
 */
export class CreateFromOrdersBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsInt({ each: true })
  orders: number[];

  /**
   * Por cada order_id, lista de items a despachar (opcional). Si una orden
   * no aparece aquí, se asume quick-accept (todas las líneas pendientes).
   */
  @IsOptional()
  items_by_order?: Record<number, CreateFromOrderItemDto[]>;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  batch_key?: string;

  @IsOptional()
  @IsBoolean()
  atomic?: boolean;

  @IsOptional()
  @IsIn(['draft', 'confirmed'])
  target_status?: 'draft' | 'confirmed';

  @IsOptional()
  @ValidateNested()
  @Type(() => RouteAssignmentDto)
  route_assignment?: RouteAssignmentDto;
}