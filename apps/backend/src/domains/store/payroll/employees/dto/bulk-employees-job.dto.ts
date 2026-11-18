import { IsNotEmpty, IsString } from 'class-validator';
import { BulkJobFileDto } from '../../../bulk-uploads/dto/bulk-upload-job.dto';

/** `POST store/payroll/employees/bulk/jobs` (QUI-1009). */
export class BulkEmployeesJobDto extends BulkJobFileDto {
  @IsString()
  @IsNotEmpty()
  session_id: string;
}
