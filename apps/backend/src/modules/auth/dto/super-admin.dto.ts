import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsNotEmpty } from 'class-validator';

export class VerifyUserEmailAsSuperAdminDto {
  @ApiProperty({
    description: 'ID del usuario cuyo email se va a verificar',
    example: 123,
  })
  @IsNumber()
  @IsNotEmpty()
  userId: number;
}
