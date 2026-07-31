import { IsString } from 'class-validator';
import { IsStrongPassword } from '../../../../common/validators/password-policy';

export class ResetPasswordStoreUserDto {
  @IsString()
  @IsStrongPassword()
  new_password: string;

  /**
   * Solo se compara contra `new_password` en el servicio: aplicarle la política
   * duplicaría el mismo error en dos campos.
   */
  @IsString()
  confirm_password: string;
}
