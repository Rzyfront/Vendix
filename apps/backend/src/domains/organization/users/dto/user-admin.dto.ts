import { IsNotEmpty, IsString } from 'class-validator';
import { IsStrongPassword } from '../../../../common/validators/password-policy';

export class VerifyEmailDto {
  @IsNotEmpty({ message: 'User ID is required' })
  @IsString()
  user_id: string;
}

export class AdminResetPasswordDto {
  @IsNotEmpty({ message: 'New password is required' })
  @IsString()
  @IsStrongPassword()
  new_password: string;

  @IsNotEmpty({ message: 'Password confirmation is required' })
  @IsString()
  confirm_password: string;
}
