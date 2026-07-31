import { IsNumber, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class CloseSessionDto {
  @IsNumber()
  @Type(() => Number)
  actual_closing_amount: number;

  @IsOptional()
  @IsString()
  closing_notes?: string;

  /**
   * QUI-572 — efectivo esperado que el cliente TENÍA EN PANTALLA al enviar.
   * Opcional a propósito: si no llega, el cierre se comporta como antes
   * (compatibilidad con `apps/mobile` y otros consumidores).
   */
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  expected_closing_amount_seen?: number;
}
