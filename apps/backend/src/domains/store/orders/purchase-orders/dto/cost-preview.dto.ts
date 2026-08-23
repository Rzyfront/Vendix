import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { tax_type_enum } from '@prisma/client';
import {
  IsValidFreightAndTax,
  PURCHASE_ORDER_ITEMS_MAX,
  SHIPPING_COST_ALLOCATIONS,
  ShippingCostAllocation,
  toOptionalBoolean,
  toOptionalNumber,
} from './create-purchase-order.dto';

/** Allowed fiscal tax classifications for a preview line (F1 IVA lifecycle). */
const TAX_TYPE_VALUES = Object.values(tax_type_enum) as string[];

export class CostPreviewItemDto {
  @IsInt()
  @Min(1)
  product_id: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  product_variant_id?: number;

  // Fracción admitida (3 decimales) a propósito: la vista previa muestra el
  // efecto de una cantidad fraccionaria ANTES de convertirla a unidades de
  // stock. La CREACIÓN exige entero (`PurchaseOrderItemDto.quantity`) porque
  // `quantity_ordered` es `Int` en Prisma.
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantity: number;

  /**
   * Gross unit cost the operator typed on the line. F1 derives the NET cost
   * from this using `tax_rate` + the effective `prices_include_tax` mode, so
   * the preview mirrors what `create`/`receive` will persist.
   */
  @IsNumber()
  @Min(0.0001)
  unit_cost: number;

  /**
   * QUI-661 — descuento comercial de la línea. La vista previa tiene que
   * recibirlo o el margen que muestra se calcula contra un costo que la orden
   * nunca va a tener. El servicio ya lo leía por cast; sin declararlo acá,
   * `forbidNonWhitelisted` devolvía 400 y ese código era inalcanzable.
   */
  @Transform(toOptionalNumber)
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  discount_percentage?: number;

  /** QUI-661 — descuento de línea como monto. Gana sobre el porcentaje. */
  @Transform(toOptionalNumber)
  @IsNumber()
  @Min(0)
  @IsOptional()
  discount_amount?: number;

  /** F1: line tax rate (percentage, e.g. 19 for 19%). */
  @Transform(toOptionalNumber)
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  tax_rate?: number;

  /** F1: line tax type (iva | inc | ...). Defaults to iva. */
  @IsIn(TAX_TYPE_VALUES)
  @IsOptional()
  tax_type?: string;

  /** F1: per-line override of the header `prices_include_tax` (mixed invoices). */
  @Transform(toOptionalBoolean)
  @IsBoolean()
  @IsOptional()
  prices_include_tax?: boolean;
}

export class CostPreviewDto {
  @IsInt()
  @Min(1)
  @IsValidFreightAndTax()
  location_id: number;

  /** F1: dominant invoice tax mode. true = the entered unit_cost already includes tax. */
  @Transform(toOptionalBoolean)
  @IsBoolean()
  @IsOptional()
  prices_include_tax?: boolean;

  /**
   * QUI-661 — descuento general de la factura. Viaja acá para que la vista
   * previa reciba EXACTAMENTE las mismas entradas que la creación y la
   * recepción: mientras no lo aceptara, la simulación y la orden partían de
   * bases distintas y el operador aprobaba una cifra que no se podía reproducir.
   */
  @Transform(toOptionalNumber)
  @IsNumber()
  @Min(0)
  @IsOptional()
  discount_amount?: number;

  /**
   * Flete de la factura. Dos decimales OBLIGATORIOS: la columna que lo recibe
   * es `Decimal(12,2)` y PostgreSQL y JavaScript no redondean igual el tercero.
   */
  @Transform(toOptionalNumber)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  shipping_cost?: number;

  /** Cómo se imputa el flete: `prorate` capitaliza al costo, `expense` no. */
  @IsIn(SHIPPING_COST_ALLOCATIONS as unknown as string[])
  @IsOptional()
  shipping_cost_allocation?: ShippingCostAllocation;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PURCHASE_ORDER_ITEMS_MAX)
  @ValidateNested({ each: true })
  @Type(() => CostPreviewItemDto)
  items: CostPreviewItemDto[];
}
