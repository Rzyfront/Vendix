import {
  IsString,
  IsNotEmpty,
  IsEnum,
  Matches,
  IsOptional,
} from 'class-validator';

export enum WompiEnvironmentEnum {
  SANDBOX = 'SANDBOX',
  PRODUCTION = 'PRODUCTION',
}

export class WompiConfigValidator {
  @IsString()
  @IsNotEmpty({ message: 'La llave pública de Wompi es requerida' })
  @Matches(/^pub_(test|prod)_/, {
    message: 'La llave pública debe iniciar con pub_test_ o pub_prod_',
  })
  public_key: string;

  @IsString()
  @IsNotEmpty({ message: 'La llave privada de Wompi es requerida' })
  @Matches(/^prv_(test|prod)_/, {
    message: 'La llave privada debe iniciar con prv_test_ o prv_prod_',
  })
  private_key: string;

  @IsString()
  @IsNotEmpty({ message: 'El secret de eventos de Wompi es requerido' })
  events_secret: string;

  @IsString()
  @IsNotEmpty({ message: 'El secret de integridad de Wompi es requerido' })
  integrity_secret: string;

  @IsEnum(WompiEnvironmentEnum, {
    message: 'El ambiente debe ser SANDBOX o PRODUCTION',
  })
  @IsOptional()
  environment?: WompiEnvironmentEnum;
}
