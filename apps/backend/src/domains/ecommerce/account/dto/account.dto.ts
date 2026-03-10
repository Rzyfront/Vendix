import { IsString, IsEmail, IsOptional, MinLength, Matches } from 'class-validator';
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
    @Matches(/^[\d+#*\s()-]*$/, { message: 'El teléfono solo puede contener números y los símbolos + # * ( ) -' })
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
    @IsNotEmpty({ message: 'La dirección es requerida' })
    address_line1: string;

    @IsOptional()
    @IsString()
    address_line2?: string;

    @IsString()
    @IsNotEmpty({ message: 'La ciudad es requerida' })
    city: string;

    @IsOptional()
    @IsString()
    state_province?: string;

    @IsString()
    @IsNotEmpty({ message: 'El código de país es requerido' })
    country_code: string;

    @IsOptional()
    @IsString()
    postal_code?: string;

    @IsOptional()
    @IsString()
    @Matches(/^[\d+#*\s()-]*$/, { message: 'El teléfono solo puede contener números y los símbolos + # * ( ) -' })
    phone_number?: string;

    @IsOptional()
    is_primary?: boolean;

    @IsOptional()
    @IsString()
    type?: string;
}

export class UpdateAddressDto {
    @IsString()
    @IsNotEmpty({ message: 'La dirección es requerida' })
    address_line1: string;

    @IsOptional()
    @IsString()
    address_line2?: string;

    @IsString()
    @IsNotEmpty({ message: 'La ciudad es requerida' })
    city: string;

    @IsOptional()
    @IsString()
    state_province?: string;

    @IsString()
    @IsNotEmpty({ message: 'El código de país es requerido' })
    country_code: string;

    @IsOptional()
    @IsString()
    postal_code?: string;

    @IsOptional()
    @IsString()
    @Matches(/^[\d+#*\s()-]*$/, { message: 'El teléfono solo puede contener números y los símbolos + # * ( ) -' })
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
