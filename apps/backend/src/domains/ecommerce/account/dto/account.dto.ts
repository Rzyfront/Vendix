import { IsString, IsEmail, IsOptional, MinLength } from 'class-validator';
import { ApiSchema } from '@nestjs/swagger';

@ApiSchema({ name: 'EcommerceAccountUpdateProfileDto' })
export class EcommerceAccountUpdateProfileDto {
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

    @IsOptional()
    @IsString()
    avatar_url?: string;

    @IsOptional()
    @IsString()
    username?: string;
}

@ApiSchema({ name: 'EcommerceAccountChangePasswordDto' })
export class EcommerceAccountChangePasswordDto {
    @IsString()
    @MinLength(1)
    current_password: string;

    @IsString()
    @MinLength(8)
    new_password: string;
}

@ApiSchema({ name: 'EcommerceAccountCreateAddressDto' })
export class EcommerceAccountCreateAddressDto {
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

    @IsOptional()
    @IsString()
    type?: string;
}

export class UpdateAddressDto {
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

    @IsOptional()
    @IsString()
    type?: string;
}

export {
    EcommerceAccountUpdateProfileDto as UpdateProfileDto,
    EcommerceAccountChangePasswordDto as ChangePasswordDto,
    EcommerceAccountCreateAddressDto as CreateAddressDto,
};
