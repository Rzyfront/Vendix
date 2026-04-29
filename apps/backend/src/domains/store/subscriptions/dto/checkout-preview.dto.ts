import { IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export class CheckoutPreviewDto {
  @Type(() => Number)
  @IsNumber()
  planId: number;

  /**
   * S2.1 — Optional redemption code. When present the preview re-validates the
   * coupon server-side and embeds the projected overlay in the response.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  coupon_code?: string;
}
