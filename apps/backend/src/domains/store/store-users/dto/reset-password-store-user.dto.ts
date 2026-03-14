import { IsString, MinLength } from 'class-validator';

export class ResetPasswordStoreUserDto {
  @IsString()
  @MinLength(8)
  new_password: string;

  @IsString()
  @MinLength(8)
  confirm_password: string;
}
