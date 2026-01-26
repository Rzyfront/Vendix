import { IsString, IsOptional, MaxLength, IsHexColor } from 'class-validator';

export class CreateExpenseCategoryDto {
    @IsString()
    @MaxLength(100)
    name: string;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    description?: string;

    @IsOptional()
    @IsString()
    @IsHexColor()
    color?: string;
}
