import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
  ValidationPipe,
} from '@nestjs/common';
import { flattenValidationMessages } from '@common/validators/bulk-validation.util';

/**
 * A single component line within a recipe BOM batch replacement.
 *
 * Extends the same validation constraints as `CreateRecipeItemDto`, plus an
 * optional `id` pointing to an existing `recipe_items.id`. When `id` is
 * provided, the existing line is updated in-place; when omitted, a new line is
 * inserted.
 */
export class RecipeItemInputDto {
  @ApiPropertyOptional({
    description:
      'ID de la línea existente en recipe_items (opcional). Si se omite, se crea un nuevo insumo.',
    example: 180,
  })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  id?: number;

  @ApiProperty({
    description:
      'ID del producto componente (insumo). Debe pertenecer a la misma tienda y no tener variantes.',
    example: 45,
  })
  @IsInt()
  @Type(() => Number)
  component_product_id!: number;

  @ApiProperty({
    description:
      'Cantidad del sub-componente requerida por lote de la receta. Debe ser > 0.',
    example: 2.5,
  })
  @IsDefined({ message: 'La cantidad del sub-componente es obligatoria' })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Type(() => Number)
  @Min(0.0001, {
    message: 'La cantidad del sub-componente debe ser mayor a 0',
  })
  quantity!: number;

  @ApiPropertyOptional({
    description: 'Porcentaje de merma (0 - 100).',
    example: 5,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Type(() => Number)
  @Min(0)
  @Max(100)
  waste_percent?: number;

  @ApiPropertyOptional({
    description: 'Modo de merma: percent o absolute.',
    enum: ['percent', 'absolute'],
    default: 'percent',
  })
  @IsOptional()
  @IsIn(['percent', 'absolute'])
  waste_mode?: 'percent' | 'absolute';

  @ApiPropertyOptional({
    description: 'Merma absoluta en la unidad de stock del insumo.',
    example: 0.1,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Type(() => Number)
  @Min(0)
  waste_absolute?: number;

  @ApiPropertyOptional({
    description: 'Indica si el insumo es opcional.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) =>
    typeof value === 'string' ? value === 'true' : value,
  )
  is_optional?: boolean;
}

/**
 * Payload wrapper for replacing all items of a recipe atomically.
 */
export class ReplaceRecipeItemsDto {
  @ApiProperty({
    description:
      'Lista completa de insumos que compondrán la receta tras la sincronización.',
    type: [RecipeItemInputDto],
  })
  @IsArray()
  @ArrayMaxSize(200, {
    message: 'Una receta no puede tener más de 200 componentes',
  })
  @ValidateNested({ each: true })
  @Type(() => RecipeItemInputDto)
  items!: RecipeItemInputDto[];
}

/**
 * Normalizes and validates the body of `PUT /store/recipes/:id/items`.
 *
 * Accepts either:
 *  - A bare array of items: `RecipeItemInputDto[]`
 *  - A wrapped object: `{ items: RecipeItemInputDto[] }`
 *
 * Ensures full validation against `ReplaceRecipeItemsDto` regardless of which
 * shape the client sends.
 */
@Injectable()
export class ParseReplaceRecipeItemsPipe implements PipeTransform {
  private readonly validationPipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    transformOptions: {
      enableImplicitConversion: true,
    },
    exceptionFactory: (errors) => {
      const messages = flattenValidationMessages(errors);
      return new BadRequestException(messages);
    },
  });

  async transform(
    value: unknown,
    _metadata: ArgumentMetadata,
  ): Promise<ReplaceRecipeItemsDto> {
    const raw = Array.isArray(value) ? { items: value } : value;
    return (await this.validationPipe.transform(raw, {
      type: 'body',
      metatype: ReplaceRecipeItemsDto,
    })) as ReplaceRecipeItemsDto;
  }
}
