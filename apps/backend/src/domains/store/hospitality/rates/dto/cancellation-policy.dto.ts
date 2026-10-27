import { ApiProperty, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PENALTY_TYPES, PenaltyType } from '../lodging-cancellation-penalty';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Penalty: first N nights of the stay, or a percent of its total. */
export class PenaltyTermDto {
  @ApiProperty({ enum: PENALTY_TYPES })
  @IsIn(PENALTY_TYPES)
  penalty_type!: PenaltyType;

  @ApiProperty({ description: 'Noches (1-30) o porcentaje (0-100).' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  penalty_value!: number;
}

/** Penalty applied when cancelling less than `hours_before` hours before check-in. */
export class CancellationRuleDto extends PenaltyTermDto {
  @ApiProperty({ example: 48, description: 'Horas antes de la hora de check-in.' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(8760)
  hours_before!: number;
}

/** Cancellation policy of a rate plan (H2.4). */
export class CreateCancellationPolicyDto {
  @ApiProperty({ example: 'Flexible' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @ApiProperty({
    type: [CancellationRuleDto],
    description: 'Ventanas de penalidad. Sin ventanas = cancelación gratis.',
  })
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => CancellationRuleDto)
  rules!: CancellationRuleDto[];

  @ApiProperty({ required: false, nullable: true, type: PenaltyTermDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PenaltyTermDto)
  no_show_penalty?: PenaltyTermDto | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateCancellationPolicyDto extends PartialType(CreateCancellationPolicyDto) {}
