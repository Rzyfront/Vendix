import { IsOptional, IsString, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Query de `GET /store/customers/lookup/external`.
 *
 * El documento admite separadores habituales (puntos, guiones, espacios) porque
 * el operador lo teclea como lo ve en el RUT; el servicio lo canonicaliza. Se
 * exigen al menos 5 dígitos para no disparar consultas sin sentido.
 */
export class ExternalCustomerLookupDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(/^(?=(?:\D*\d){5})[\d.\-\s]+$/, {
    message:
      'document_number debe tener al menos 5 dígitos y solo dígitos, puntos, guiones o espacios',
  })
  document_number!: string;

  @IsOptional()
  @IsString()
  document_type?: string;
}
