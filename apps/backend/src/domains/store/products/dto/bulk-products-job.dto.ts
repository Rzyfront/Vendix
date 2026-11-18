import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { BulkJobFileDto } from '../../bulk-uploads/dto/bulk-upload-job.dto';

/** `POST store/products/bulk/jobs` (QUI-1009). */
export class BulkProductsJobDto extends BulkJobFileDto {
  @IsString()
  @IsNotEmpty()
  session_id: string;

  @ApiPropertyOptional({
    description: 'Consentimiento de carga inicial de inventario',
  })
  @IsOptional()
  @IsBoolean()
  initial_load_ack?: boolean;
}
