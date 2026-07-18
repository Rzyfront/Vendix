import {
  IsString,
  IsEmail,
  IsOptional,
  IsIn,
  MinLength,
  MaxLength,
  Matches,
} from 'class-validator';

/**
 * Roles operativos que un admin de tienda puede asignar al crear un usuario.
 * `carrier` (Vendix Repartos) fuerza app_type=STORE_DELIVERY en el servicio;
 * el resto opera bajo STORE_ADMIN. `owner`/`super_admin` son inmutables y no
 * se asignan por esta vía.
 */
export const ASSIGNABLE_STORE_USER_ROLES = [
  'manager',
  'supervisor',
  'employee',
  'cashier',
  'carrier',
] as const;

export class CreateStoreUserDto {
  @IsString()
  @MaxLength(100)
  first_name: string;

  @IsString()
  @MaxLength(100)
  last_name: string;

  @IsEmail()
  @MaxLength(255)
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  @Matches(/^[a-zA-Z0-9_]+$/)
  username?: string;

  /**
   * Rol operativo a asignar. Por defecto `employee` (preserva el
   * comportamiento previo). `carrier` ⇒ app_type=STORE_DELIVERY.
   */
  @IsOptional()
  @IsIn(ASSIGNABLE_STORE_USER_ROLES as unknown as string[])
  role?: string;
}
