import { IsNotEmpty, IsString } from 'class-validator';
import {
  BulkFileHashField,
  BulkFileNameField,
} from '../../bulk-uploads/dto/bulk-upload-log.dto';

export class BulkImageSkuResultDto {
  sku: string;
  status: 'success' | 'error' | 'skipped';
  message: string;
  images_uploaded: number;
  product_id?: number;
}

export class BulkImageUploadResultDto {
  success: boolean;
  total_skus_processed: number;
  successful: number;
  failed: number;
  skipped: number;
  results: BulkImageSkuResultDto[];
}

/**
 * Body de `POST store/products/bulk-images/upload-session`. `file_name` y
 * `file_hash` vienen del analyze para el registro de cargas (QUI-1004).
 */
export class BulkImageUploadSessionDto {
  @IsString()
  @IsNotEmpty()
  session_id: string;

  @BulkFileNameField()
  file_name?: string;

  @BulkFileHashField()
  file_hash?: string;
}
