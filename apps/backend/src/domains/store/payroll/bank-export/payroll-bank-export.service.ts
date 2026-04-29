import { Injectable, Inject, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { S3Service } from '../../../../common/services/s3.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import {
  BANK_BATCH_BUILDER_REGISTRY,
  BankBatchBuilder,
  BankBatchEmployee,
} from './interfaces/bank-batch-builder.interface';

@Injectable()
export class PayrollBankExportService {
  private readonly logger = new Logger(PayrollBankExportService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly s3_service: S3Service,
    @Inject(BANK_BATCH_BUILDER_REGISTRY)
    private readonly builders: BankBatchBuilder[],
  ) {}

  /**
   * Returns list of available bank codes for ACH export.
   */
  getAvailableBanks(): { code: string; name: string }[] {
    return this.builders.map((b) => ({ code: b.bankCode, name: b.bankName }));
  }

  /**
   * Validates employee bank data for a payroll run.
   * Returns valid employees and invalid ones with error details.
   */
  async validateEmployeeBankData(payroll_run_id: number): Promise<{
    valid: BankBatchEmployee[];
    invalid: { employee_id: number; name: string; errors: string[] }[];
  }> {
    const employees = await this.loadEmployees(payroll_run_id);

    const valid: BankBatchEmployee[] = [];
    const invalid: { employee_id: number; name: string; errors: string[] }[] =
      [];

    for (const emp of employees) {
      const errors: string[] = [];

      if (!emp.bank_account_number) errors.push('Missing bank account number');
      if (!emp.bank_account_type) errors.push('Missing bank account type');
      if (!emp.bank_name) errors.push('Missing bank name');
      if (!emp.net_pay || emp.net_pay <= 0)
        errors.push('Invalid net pay amount');

      if (errors.length > 0) {
        invalid.push({
          employee_id: emp.employee_id,
          name: `${emp.first_name} ${emp.last_name}`,
          errors,
        });
      } else {
        valid.push(emp);
      }
    }

    return { valid, invalid };
  }

  /**
   * Generates and uploads an ACH bank file for a payroll run.
   */
  async exportBatch(
    payroll_run_id: number,
    bank: string,
    source_account?: string,
    source_account_type?: string,
  ): Promise<{
    download_url: string;
    file_name: string;
    record_count: number;
    total_amount: number;
  }> {
    // 1. Load and validate payroll run
    const payroll_run = await this.prisma.payroll_runs.findFirst({
      where: { id: payroll_run_id },
    });

    if (!payroll_run) {
      throw new VendixHttpException(ErrorCodes.PAYROLL_FIND_002);
    }

    if (!['approved', 'paid'].includes(payroll_run.status)) {
      throw new VendixHttpException(
        ErrorCodes.PAYROLL_STATUS_001,
        `Cannot export ACH for payroll in '${payroll_run.status}' status. Must be approved or paid.`,
      );
    }

    // 2. Find the builder for the requested bank
    const builder = this.builders.find((b) => b.bankCode === bank);
    if (!builder) {
      throw new VendixHttpException(
        ErrorCodes.PAYROLL_STATUS_001,
        `Unsupported bank: ${bank}. Available: ${this.builders.map((b) => b.bankCode).join(', ')}`,
      );
    }

    // 3. Load employees with payroll items
    const employees = await this.loadEmployees(payroll_run_id);

    if (employees.length === 0) {
      throw new VendixHttpException(
        ErrorCodes.PAYROLL_STATUS_001,
        'No employees with valid payroll items found for this run.',
      );
    }

    // 4. Validate bank data
    const validation_errors = builder.validate(employees);
    if (validation_errors.length > 0) {
      throw new VendixHttpException(
        ErrorCodes.PAYROLL_STATUS_001,
        `Bank data validation failed:\n${validation_errors.join('\n')}`,
      );
    }

    // 5. Get organization data
    const context = RequestContextService.getContext();
    const organization = await this.prisma.organizations.findFirst({
      where: { id: context?.organization_id },
      select: { id: true, name: true, tax_id: true },
    });

    if (!organization?.tax_id) {
      throw new VendixHttpException(
        ErrorCodes.PAYROLL_STATUS_001,
        'Organization tax ID (NIT) is required for ACH export. Please configure it in organization settings.',
      );
    }

    const total_amount = employees.reduce((sum, e) => sum + e.net_pay, 0);

    // 6. Build the file
    const result = builder.build(
      {
        payroll_run_id,
        payroll_number: payroll_run.payroll_number,
        company_name: organization.name,
        company_nit: organization.tax_id,
        payment_date: payroll_run.payment_date || new Date(),
        total_amount,
        record_count: employees.length,
        source_account: source_account || '',
        source_account_type: source_account_type || 'savings',
      },
      employees,
    );

    // 7. Upload to S3
    const org_id = context?.organization_id || 0;
    const timestamp = Date.now();
    const s3_key = `payroll/ach/${org_id}/${payroll_run.payroll_number}_${bank}_${timestamp}.txt`;

    await this.s3_service.uploadFile(
      result.file_content,
      s3_key,
      result.mime_type,
    );

    this.logger.log(
      `ACH file generated: ${result.file_name} (${result.record_count} records, $${result.total_amount})`,
    );

    // 8. Return presigned download URL
    const download_url = await this.s3_service.getPresignedUrl(s3_key, 3600);

    return {
      download_url,
      file_name: result.file_name,
      record_count: result.record_count,
      total_amount: result.total_amount,
    };
  }

  /**
   * Loads employees with their payroll item data for a given payroll run.
   */
  private async loadEmployees(
    payroll_run_id: number,
  ): Promise<BankBatchEmployee[]> {
    const items = await this.prisma.payroll_items.findMany({
      where: { payroll_run_id },
      include: {
        employee: {
          select: {
            id: true,
            employee_code: true,
            first_name: true,
            last_name: true,
            document_type: true,
            document_number: true,
            bank_name: true,
            bank_account_number: true,
            bank_account_type: true,
          },
        },
      },
    });

    return items.map((item) => ({
      employee_id: item.employee.id,
      employee_code: item.employee.employee_code,
      first_name: item.employee.first_name,
      last_name: item.employee.last_name,
      document_type: item.employee.document_type,
      document_number: item.employee.document_number,
      bank_name: item.employee.bank_name || '',
      bank_account_number: item.employee.bank_account_number || '',
      bank_account_type: item.employee.bank_account_type || '',
      net_pay: Number(item.net_pay),
    }));
  }
}
