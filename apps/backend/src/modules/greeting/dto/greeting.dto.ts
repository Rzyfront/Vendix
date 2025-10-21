// apps/backend/src/modules/greeting/dto/greeting.dto.ts
import { IsString, IsOptional, MinLength, MaxLength, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum InsultLevel {
    SUAVE = 'suave',
    MODERADO = 'moderado',
    PICANTE = 'picante'
}

export class CreateGreetingDto {
    @ApiProperty({
        description: 'Nombre de la víctima... digo, persona a saludar',
        example: 'Balmes',
        minLength: 2,
        maxLength: 50,
    })
    @IsString()
    @MinLength(2)
    @MaxLength(50)
    name: string;

    @ApiPropertyOptional({
        description: 'Nivel de intensidad del insulto gracioso',
        example: InsultLevel.SUAVE,
        enum: InsultLevel,
        default: InsultLevel.SUAVE,
    })
    @IsOptional()
    @IsEnum(InsultLevel)
    intensity?: InsultLevel;

    @ApiPropertyOptional({
        description: 'Tema específico del insulto',
        example: 'programador',
        enum: ['programador', 'diseñador', 'gerente', 'estudiante', 'general'],
    })
    @IsOptional()
    @IsString()
    @MaxLength(30)
    theme?: string;
}
