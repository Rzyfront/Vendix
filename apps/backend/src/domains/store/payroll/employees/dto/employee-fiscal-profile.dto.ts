import {
  IsString,
  IsNumber,
  IsOptional,
  IsInt,
  IsIn,
  Min,
  Max,
  IsEnum,
  ValidateIf,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';

export type RetentionProcedureDto = 'proc1' | 'proc2';

/**
 * DTO del perfil fiscal del empleado (art. 387 ET).
 *
 * Aplicado en cada cálculo de nómina por la pipeline art. 383/387/336:
 * - dependents_count: hasta 10 (la lógica interna trunca a 4 que es el
 *   máximo legal según art. 387 ET; permitimos más para registrar un
 *   padrastro histórico sin romper validaciones).
 * - housing_interest_monthly / prepaid_medicine_monthly: topeados
 *   internamente a 100/16 UVT/mes respectivamente.
 * - voluntary_pension_monthly / afc_monthly: topeados a 100 UVT/mes.
 * - retention_procedure: proc1 (art. 383) o proc2 (art. 386 ET).
 * - fixed_retention_rate: porcentaje 0..100, OBLIGATORIO si proc2.
 * - rate_semester: YYYY-1|YYYY-2, OPCIONAL pero recomendado para proc2.
 */
export class EmployeeFiscalProfileDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  @Type(() => Number)
  dependents_count?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  housing_interest_monthly?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  prepaid_medicine_monthly?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  voluntary_pension_monthly?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  afc_monthly?: number;

  @IsOptional()
  @IsIn(['proc1', 'proc2'])
  retention_procedure?: RetentionProcedureDto;

  @IsOptional()
  @ValidateIf((o: EmployeeFiscalProfileDto) => o.retention_procedure === 'proc2')
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  @Type(() => Number)
  fixed_retention_rate?: number;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-[12]$/, {
    message: 'rate_semester must match YYYY-1 or YYYY-2',
  })
  rate_semester?: string;
}

/**
 * Body de la acción de cálculo automático del porcentaje fijo semestral
 * (Procedimiento 2, art. 386 ET). `semester` es opcional: si se omite, el
 * servicio resuelve el semestre vigente a partir de la fecha del servidor
 * (jun→semestre 2 del año en curso, dic→semestre 1 del año siguiente en la
 * práctica operativa, aunque el cálculo real solo depende de la fecha de
 * corte, no del mes de ejecución).
 */
export class CalculateSemesterRateDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-[12]$/, {
    message: 'semester must match YYYY-1 or YYYY-2',
  })
  semester?: string;
}
