import { IsNotEmpty, IsString } from 'class-validator';

export class RefreshTokenDto {
  @IsString({ message: 'El refresh token debe ser un string' })
  @IsNotEmpty({ message: 'El refresh token es requerido' })
  refresh_token: string;
}
