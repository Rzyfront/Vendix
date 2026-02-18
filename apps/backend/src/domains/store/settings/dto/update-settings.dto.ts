import { IsOptional, ValidateNested, IsObject } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiSchema } from '@nestjs/swagger';
import {
  GeneralSettingsDto,
  InventorySettingsDto,
  CheckoutSettingsDto,
  NotificationsSettingsDto,
  PosSettingsDto,
  ReceiptsSettingsDto,
  AppSettingsDto,
  BrandingSettingsDto,
  FontsSettingsDto,
  PublicationSettingsDto,
  PanelUISettingsDto,
} from './settings-schemas.dto';
import { EcommerceSettingsDto } from '../../ecommerce/dto/ecommerce-settings.dto';

@ApiSchema({ name: 'StoreUpdateSettingsDto' })
export class UpdateSettingsDto {
  @ApiProperty({ type: GeneralSettingsDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => GeneralSettingsDto)
  general?: GeneralSettingsDto;

  @ApiProperty({ type: InventorySettingsDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => InventorySettingsDto)
  inventory?: InventorySettingsDto;

  @ApiProperty({ type: CheckoutSettingsDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => CheckoutSettingsDto)
  checkout?: CheckoutSettingsDto;

  @ApiProperty({ type: NotificationsSettingsDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => NotificationsSettingsDto)
  notifications?: NotificationsSettingsDto;

  @ApiProperty({ type: PosSettingsDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => PosSettingsDto)
  pos?: PosSettingsDto;

  @ApiProperty({ type: ReceiptsSettingsDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => ReceiptsSettingsDto)
  receipts?: ReceiptsSettingsDto;

  @ApiProperty({ type: AppSettingsDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => AppSettingsDto)
  app?: AppSettingsDto;

  @ApiProperty({ type: BrandingSettingsDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => BrandingSettingsDto)
  branding?: BrandingSettingsDto;

  @ApiProperty({ type: FontsSettingsDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => FontsSettingsDto)
  fonts?: FontsSettingsDto;

  @ApiProperty({ type: PublicationSettingsDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => PublicationSettingsDto)
  publication?: PublicationSettingsDto;

  @ApiProperty({ type: PanelUISettingsDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => PanelUISettingsDto)
  panel_ui?: PanelUISettingsDto;

  @ApiProperty({ type: EcommerceSettingsDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => EcommerceSettingsDto)
  ecommerce?: EcommerceSettingsDto;
}
