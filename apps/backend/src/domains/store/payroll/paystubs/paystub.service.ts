import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { S3Service } from '../../../../common/services/s3.service';
import {
  PaystubPdfBuilder,
  PaystubData,
  SettlementPaystubData,
} from './paystub-pdf.builder';

/** Maps payroll earnings JSON keys to display labels. */
const EARNINGS_LABELS: Record<string, string> = {
  base_salary: 'Salario Basico',
  transport_subsidy: 'Auxilio de Transporte',
  overtime: 'Horas Extra',
  night_surcharge: 'Recargo Nocturno',
  sunday_holiday: 'Dominicales y Festivos',
  commissions: 'Comisiones',
  bonuses: 'Bonificaciones',
  other_earnings: 'Otros Devengados',
};

/** Maps payroll deductions JSON keys to display labels. */
const DEDUCTIONS_LABELS: Record<string, string> = {
  health: 'Salud',
  pension: 'Pension',
  retention: 'Retencion en la Fuente',
  advance_deduction: 'Descuento Adelanto',
  solidarity_fund: 'Fondo de Solidaridad',
  other_deductions: 'Otras Deducciones',
};

/** Keys to skip when mapping JSON to concept arrays (they are summation fields). */
const SKIP_KEYS = new Set(['total']);

@Injectable()
export class PaystubService {
  private readonly logger = new Logger(PaystubService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly s3_service: S3Service,
  ) {}

  // ─── Public API ──────────────────────────────────────────────────

  /**
   * Generate (or regenerate) a paystub PDF for a single payroll item.
   * Uploads to S3 and persists the key in `payroll_items.paystub_url`.
   */
  async generatePaystub(
    payroll_item_id: number,
  ): Promise<{ url: string }> {
    const item = await this.prisma.payroll_items.findFirst({
      where: { id: payroll_item_id },
      include: {
        employee: true,
        payroll_run: {
          include: {
            organization: {
              select: { id: true, name: true, tax_id: true, logo_url: true },
            },
          },
        },
      },
    });

    if (!item) {
      throw new NotFoundException('Payroll item not found');
    }

    const org = item.payroll_run.organization;
    const employee = item.employee;
    const run = item.payroll_run;

    // Optionally download logo
    let logo_buffer: Buffer | undefined;
    if (org.logo_url) {
      try {
        logo_buffer = await this.s3_service.downloadImage(org.logo_url);
      } catch {
        this.logger.warn('Could not download organization logo for paystub');
      }
    }

    const earnings = this.mapJsonToConcepts(item.earnings, EARNINGS_LABELS);
    const deductions = this.mapJsonToConcepts(item.deductions, DEDUCTIONS_LABELS);

    const data: PaystubData = {
      company_name: org.name,
      company_nit: org.tax_id || 'N/A',
      company_logo_buffer: logo_buffer,
      employee_name: `${employee.first_name} ${employee.last_name}`,
      employee_code: employee.employee_code,
      document_type: employee.document_type,
      document_number: employee.document_number,
      position: employee.position || undefined,
      department: employee.department || undefined,
      period_start: this.formatDate(run.period_start),
      period_end: this.formatDate(run.period_end),
      payment_date: run.payment_date
        ? this.formatDate(run.payment_date)
        : undefined,
      payroll_number: run.payroll_number,
      earnings,
      deductions,
      total_earnings: Number(item.total_earnings),
      total_deductions: Number(item.total_deductions),
      net_pay: Number(item.net_pay),
    };

    const pdf_buffer = await PaystubPdfBuilder.generatePaystub(data);

    // Upload to S3
    const s3_key = `organizations/${org.id}/payroll/paystubs/${run.id}/${employee.employee_code}.pdf`;
    await this.s3_service.uploadFile(pdf_buffer, s3_key, 'application/pdf');

    // Persist S3 key on the payroll item
    await this.prisma.payroll_items.update({
      where: { id: payroll_item_id },
      data: { paystub_url: s3_key },
    });

    const url = await this.s3_service.getPresignedUrl(s3_key);
    return { url };
  }

  /**
   * Generate paystub PDFs for all items in a payroll run.
   * Only runs that are approved or paid are allowed.
   */
  async generateBulkPaystubs(
    payroll_run_id: number,
  ): Promise<{ generated: number; errors: string[] }> {
    const run = await this.prisma.payroll_runs.findFirst({
      where: { id: payroll_run_id },
    });

    if (!run) {
      throw new NotFoundException('Payroll run not found');
    }

    const allowed_statuses = ['approved', 'paid', 'sent', 'accepted'];
    if (!allowed_statuses.includes(run.status)) {
      throw new BadRequestException(
        'Payroll run must be approved or paid to generate paystubs',
      );
    }

    const items = await this.prisma.payroll_items.findMany({
      where: { payroll_run_id },
      select: { id: true, employee: { select: { employee_code: true } } },
    });

    let generated = 0;
    const errors: string[] = [];

    for (const item of items) {
      try {
        await this.generatePaystub(item.id);
        generated++;
      } catch (error) {
        const code = item.employee?.employee_code || `item_${item.id}`;
        this.logger.error(
          `Error generating paystub for ${code}: ${error.message}`,
        );
        errors.push(`${code}: ${error.message}`);
      }
    }

    return { generated, errors };
  }

  /**
   * Generate (or regenerate) a settlement paystub PDF.
   */
  async generateSettlementPaystub(
    settlement_id: number,
  ): Promise<{ url: string }> {
    const settlement = await this.prisma.payroll_settlements.findFirst({
      where: { id: settlement_id },
      include: {
        employee: true,
        organization: {
          select: { id: true, name: true, tax_id: true, logo_url: true },
        },
      },
    });

    if (!settlement) {
      throw new NotFoundException('Settlement not found');
    }

    const org = settlement.organization;
    const employee = settlement.employee;

    let logo_buffer: Buffer | undefined;
    if (org.logo_url) {
      try {
        logo_buffer = await this.s3_service.downloadImage(org.logo_url);
      } catch {
        this.logger.warn('Could not download organization logo for settlement paystub');
      }
    }

    const data: SettlementPaystubData = {
      company_name: org.name,
      company_nit: org.tax_id || 'N/A',
      company_logo_buffer: logo_buffer,
      employee_name: `${employee.first_name} ${employee.last_name}`,
      employee_code: employee.employee_code,
      document_type: employee.document_type,
      document_number: employee.document_number,
      position: employee.position || undefined,
      department: employee.department || undefined,
      hire_date: this.formatDate(settlement.hire_date),
      termination_date: this.formatDate(settlement.termination_date),
      termination_reason: settlement.termination_reason,
      settlement_number: settlement.settlement_number,
      days_worked: settlement.days_worked,
      base_salary: Number(settlement.base_salary),
      severance: Number(settlement.severance),
      severance_interest: Number(settlement.severance_interest),
      bonus: Number(settlement.bonus),
      vacation: Number(settlement.vacation),
      pending_salary: Number(settlement.pending_salary),
      indemnification: Number(settlement.indemnification),
      health_deduction: Number(settlement.health_deduction),
      pension_deduction: Number(settlement.pension_deduction),
      other_deductions: Number(settlement.other_deductions),
      gross_settlement: Number(settlement.gross_settlement),
      total_deductions: Number(settlement.total_deductions),
      net_settlement: Number(settlement.net_settlement),
    };

    const pdf_buffer =
      await PaystubPdfBuilder.generateSettlementPaystub(data);

    const s3_key = `organizations/${org.id}/payroll/settlements/${settlement.settlement_number}.pdf`;
    await this.s3_service.uploadFile(pdf_buffer, s3_key, 'application/pdf');

    await this.prisma.payroll_settlements.update({
      where: { id: settlement_id },
      data: { document_url: s3_key },
    });

    const url = await this.s3_service.getPresignedUrl(s3_key);
    return { url };
  }

  /**
   * Get (or lazily generate) a paystub for a payroll item.
   */
  async getPaystub(payroll_item_id: number): Promise<{ url: string }> {
    const item = await this.prisma.payroll_items.findFirst({
      where: { id: payroll_item_id },
      select: { id: true, paystub_url: true },
    });

    if (!item) {
      throw new NotFoundException('Payroll item not found');
    }

    if (item.paystub_url) {
      const url = await this.s3_service.getPresignedUrl(item.paystub_url);
      return { url };
    }

    return this.generatePaystub(payroll_item_id);
  }

  /**
   * Get (or lazily generate) a settlement paystub.
   */
  async getSettlementPaystub(
    settlement_id: number,
  ): Promise<{ url: string }> {
    const settlement = await this.prisma.payroll_settlements.findFirst({
      where: { id: settlement_id },
      select: { id: true, document_url: true },
    });

    if (!settlement) {
      throw new NotFoundException('Settlement not found');
    }

    if (settlement.document_url) {
      const url = await this.s3_service.getPresignedUrl(
        settlement.document_url,
      );
      return { url };
    }

    return this.generateSettlementPaystub(settlement_id);
  }

  // ─── Private Helpers ─────────────────────────────────────────────

  /**
   * Maps a JSON object from earnings/deductions columns to an array of
   * { label, value } for the PDF builder.
   */
  private mapJsonToConcepts(
    json: unknown,
    label_map: Record<string, string>,
  ): { label: string; value: number }[] {
    if (!json || typeof json !== 'object') return [];

    const result: { label: string; value: number }[] = [];
    const obj = json as Record<string, unknown>;

    for (const [key, raw_value] of Object.entries(obj)) {
      if (SKIP_KEYS.has(key)) continue;

      const value = Number(raw_value);
      if (!value || value === 0) continue;

      const label = label_map[key] || this.humanizeKey(key);
      result.push({ label, value });
    }

    return result;
  }

  /** Converts a snake_case key to a title-case label. */
  private humanizeKey(key: string): string {
    return key
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /** Formats a Date as DD/MM/YYYY. */
  private formatDate(date: Date): string {
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  }
}
