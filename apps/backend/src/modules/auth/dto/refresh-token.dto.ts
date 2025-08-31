import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RefreshTokenDto {
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    description: 'Refresh token JWT',
  })
  @IsString({ message: 'El refresh token debe ser un string' })
  @IsNotEmpty({ message: 'El refresh token es requerido' })
  refresh_token: string;
}
