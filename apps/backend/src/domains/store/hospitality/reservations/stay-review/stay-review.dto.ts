import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const trimOrNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

/** H8.5 — private rating the guest gives to the stay. */
export class StayReviewSubmitDto {
  @Type(() => Number)
  @IsInt({ message: 'Elige de 1 a 5 estrellas' })
  @Min(1, { message: 'Elige de 1 a 5 estrellas' })
  @Max(5, { message: 'Elige de 1 a 5 estrellas' })
  rating: number;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(1000, { message: 'El comentario admite hasta 1000 caracteres' })
  comment?: string | null;
}
