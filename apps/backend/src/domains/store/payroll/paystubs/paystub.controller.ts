import {
  Controller,
  Get,
  Post,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { PaystubService } from './paystub.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';

@Controller('store/payroll')
@UseGuards(PermissionsGuard)
export class PaystubController {
  constructor(
    private readonly paystub_service: PaystubService,
    private readonly response_service: ResponseService,
  ) {}

  /**
   * Get (or lazily generate) a paystub PDF for a single payroll item.
   */
  @Get('items/:id/payslip')
  @Permissions('payroll:read')
  async getPayslip(@Param('id') id: string) {
    const result = await this.paystub_service.getPaystub(+id);
    return this.response_service.success(result);
  }

  /**
   * Bulk-generate paystub PDFs for all items in a payroll run.
   */
  @Post('runs/:id/generate-payslips')
  @Permissions('payroll:write')
  @HttpCode(HttpStatus.OK)
  async generateBulkPayslips(@Param('id') id: string) {
    const result = await this.paystub_service.generateBulkPaystubs(+id);
    return this.response_service.success(
      result,
      `${result.generated} paystubs generated`,
    );
  }

  /**
   * Get (or lazily generate) a settlement paystub PDF.
   */
  @Get('settlements/:id/payslip')
  @Permissions('payroll:read')
  async getSettlementPayslip(@Param('id') id: string) {
    const result = await this.paystub_service.getSettlementPaystub(+id);
    return this.response_service.success(result);
  }
}
