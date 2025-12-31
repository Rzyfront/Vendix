import { IsString, IsEmail, IsOptional, MinLength } from 'class-validator';

export class UpdateProfileDto {
    @IsOptional()
    @IsString()
    first_name?: string;

    @IsOptional()
    @IsString()
    last_name?: string;

    @IsOptional()
    @IsString()
    phone?: string;

    @IsOptional()
    @IsString()
    document_type?: string;

    @IsOptional()
    @IsString()
    document_number?: string;
}

export class ChangePasswordDto {
    @IsString()
    @MinLength(1)
    current_password: string;

    @IsString()
    @MinLength(8)
    new_password: string;
}

export class CreateAddressDto {
    @IsString()
    address_line1: string;

    @IsOptional()
    @IsString()
    address_line2?: string;

    @IsString()
    city: string;

    @IsOptional()
    @IsString()
    state_province?: string;

    @IsString()
    country_code: string;

    @IsOptional()
    @IsString()
    postal_code?: string;

    @IsOptional()
    @IsString()
    phone_number?: string;

    @IsOptional()
    is_primary?: boolean;
}
