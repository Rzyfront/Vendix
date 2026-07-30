import { IsString, IsOptional, MaxLength, MinLength } from 'class-validator';

/**
 * Payload para APROBAR una solicitud de reagendamiento.
 *
 * `decision_reason` es opcional — la mayoría de las aprobaciones no
 * necesitan un comentario, pero dejamos la puerta abierta por si en
 * el futuro el admin quiere dejar nota interna.
 */
export class ApproveRescheduleRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  decision_reason?: string;
}

/**
 * Payload para RECHAZAR una solicitud de reagendamiento.
 *
 * `decision_reason` es OBLIGATORIO en el rechazo — el cliente recibe
 * este texto en la notificación y el email, así que no podemos dejarlo
 * vacío. Mínimo 3 caracteres para evitar rechazos accidentales con
 * un solo espacio.
 */
export class RejectRescheduleRequestDto {
  @IsString()
  @MinLength(3, {
    message: 'decision_reason debe tener al menos 3 caracteres',
  })
  @MaxLength(500)
  decision_reason: string;
}