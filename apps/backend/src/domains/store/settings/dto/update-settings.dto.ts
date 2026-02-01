import { IsOptional, ValidateNested, IsObject } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  GeneralSettingsDto,
  InventorySettingsDto,
  CheckoutSettingsDto,

  NotificationsSettingsDto,
  PosSettingsDto,
  ReceiptsSettingsDto,
  AppSettingsDto,
} from './settings-schemas.dto';

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
}
