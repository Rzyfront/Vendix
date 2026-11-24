import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class CheckoutCleanAssignmentDto {
  @ApiProperty()
  @IsInt()
  @IsPositive()
  unit_id: number;

  /** null leaves the clean unassigned. */
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @IsPositive()
  assigned_user_id?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}

/** Agenda unificada (F3) — the cleans accepted at the check-out. */
export class AssignCheckoutCleanDto {
  @ApiProperty({ type: [CheckoutCleanAssignmentDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CheckoutCleanAssignmentDto)
  assignments: CheckoutCleanAssignmentDto[];
}
