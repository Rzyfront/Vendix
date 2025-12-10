import { IsNotEmpty, IsString, MinLength, Matches } from 'class-validator';

export class VerifyEmailDto {
  @IsNotEmpty({ message: 'User ID is required' })
  @IsString()
  user_id: string;
}

export class ResetPasswordDto {
  @IsNotEmpty({ message: 'New password is required' })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
    message:
      'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
  })
  new_password: string;

  @IsNotEmpty({ message: 'Password confirmation is required' })
  @IsString()
  confirm_password: string;
}
