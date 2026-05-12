import { Injectable, Logger } from '@nestjs/common';
import * as zlib from 'zlib';
import {
  PayrollProviderAdapter,
  PayrollProviderResponse,
  PayrollStatusResponse,
} from '../payroll-provider.interface';
import { EncryptionService } from '../../../../../common/services/encryption.service';
import { S3Service } from '../../../../../common/services/s3.service';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../../common/context/request-context.service';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';
import {
  DianSoapClient,
  WsSecurityCredentials,
} from '../../../../store/invoicing/providers/dian-direct/dian-soap.client';
import { DianXmlSignerService } from '../../../../store/invoicing/providers/dian-direct/dian-xml-signer.service';
import { DianConfigDecrypted } from '../../../../store/invoicing/providers/dian-direct/interfaces/dian-config.interface';
import { NominaIndividualBuilder } from './xml/nomina-individual.builder';
import { NominaAdjustmentBuilder } from './xml/nomina-adjustment.builder';
import {
  NominaDocumentData,
  NominaEmpleadorData,
  NominaTrabajadorData,
  NominaDevengadosData,
  NominaDeduccionesData,
  NominaPagoData,
} from './interfaces/nomina-data.interface';
import {
  CONTRACT_TYPE_MAP,
  DOCUMENT_TYPE_MAP,
  WORKER_TYPE_MAP,
  PAYMENT_METHOD_MAP,
  DIAN_NOMINA_SOAP_ACTION,
  DEFAULT_COUNTRY_CODE,
  DEFAULT_LANGUAGE,
} from './constants/nomina-codes';

/**
 * DIAN DSPNE (Documento Soporte de Pago de Nomina Electronica) provider.
 *
 * Sends electronic payroll documents to DIAN using the existing
 * SOAP client and XML signer from the invoicing module.
 *
 * Flow per employee:
 * 1. Load DIAN config (configuration_type = 'payroll')
 * 2. Map employee data to NominaIndividual XML structure
 * 3. Build XML with NominaIndividualBuilder
 * 4. Sign XML with .p12 certificate
 * 5. ZIP + base64 encode
 * 6. Send via SOAP (SendNominaSync)
 * 7. Parse response and log result
 */
@Injectable()
export class DianPayrollProvider implements PayrollProviderAdapter {
  private readonly logger = new Logger(DianPayrollProvider.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly encryption: EncryptionService,
    private readonly s3_service: S3Service,
    private readonly soap_client: DianSoapClient,
    private readonly xml_signer: DianXmlSignerService,
    private readonly fiscalScope: FiscalScopeService,
  ) {}

  async sendPayroll(payroll_data: {
    payroll_run_id: number;
    payroll_number: string;
    period_start: Date;
    period_end: Date;
    items: Array<{
      employee_id: number;
      employee_code: string;
      document_type: string;
      document_number: string;
      first_name: string;
      last_name: string;
      base_salary: number;
      worked_days: number;
      earnings: Record<string, any>;
      deductions: Record<string, any>;
      employer_costs: Record<string, any>;
      net_pay: number;
    }>;
  }): Promise<PayrollProviderResponse> {
    const start_time = Date.now();
    const config = await this.loadPayrollConfig();

    try {
      // Load employer data from organization
      const employer = await this.loadEmployerData(config);

      // Download certificate once for all items
      const cert_buffer = config.certificate_s3_key
        ? await this.s3_service.downloadImage(config.certificate_s3_key)
        : null;

      const results: Array<{
        employee_document: string;
        success: boolean;
        cune?: string;
        message?: string;
      }> = [];

      let first_tracking_id = '';
      let first_cune = '';
      let first_xml = '';

      // Each employee generates a separate DSPNE document
      for (let i = 0; i < payroll_data.items.length; i++) {
        const item = payroll_data.items[i];
        const consecutive = String(i + 1).padStart(4, '0');
        const item_number = `${payroll_data.payroll_number}${consecutive}`;

        try {
          const result = await this.processEmployeePayroll(
            item,
            payroll_data,
            item_number,
            config,
            employer,
            cert_buffer,
          );

          results.push({
            employee_document: item.document_number,
            success: result.success,
            cune: result.cune,
            message: result.message,
          });

          if (!first_tracking_id) {
            first_tracking_id = result.tracking_id;
            first_cune = result.cune || '';
            first_xml = result.xml || '';
          }
        } catch (error) {
          this.logger.error(
            `Failed to process payroll for employee ${item.document_number}: ${error.message}`,
          );
          results.push({
            employee_document: item.document_number,
            success: false,
            message: error.message,
          });
        }
      }

      const all_success = results.every((r) => r.success);
      const success_count = results.filter((r) => r.success).length;

      return {
        success: all_success,
        tracking_id: first_tracking_id,
        cune: first_cune,
        xml_document: first_xml,
        message: all_success
          ? `Nomina enviada exitosamente: ${success_count}/${results.length} documentos aceptados`
          : `Nomina con errores: ${success_count}/${results.length} documentos aceptados`,
        raw_response: {
          results,
          duration_ms: Date.now() - start_time,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to send payroll to DIAN: ${error.message}`);
      throw error;
    }
  }

  async checkStatus(tracking_id: string): Promise<PayrollStatusResponse> {
    const config = await this.loadPayrollConfig();

    const ws_credentials = await this.loadWsCredentials(config);

    const dian_response = await this.soap_client.getStatus(
      tracking_id,
      config.environment,
      ws_credentials,
    );

    const is_valid =
      dian_response.success || dian_response.status_code === '00';

    return {
      tracking_id,
      status: is_valid ? 'accepted' : 'rejected',
      message: dian_response.status_message,
      raw_response: {
        status_code: dian_response.status_code,
        raw: dian_response.raw_response,
      },
    };
  }

  /**
   * Sends a DSPNE Nota de Ajuste (tipo 103) to DIAN.
   * References the CUNE of the original payroll document being adjusted.
   *
   * @param adjustment_type "1" = replace, "2" = delete
   */
  async sendAdjustment(
    item: {
      employee_id: number;
      employee_code: string;
      document_type: string;
      document_number: string;
      first_name: string;
      last_name: string;
      base_salary: number;
      worked_days: number;
      earnings: Record<string, any>;
      deductions: Record<string, any>;
      employer_costs: Record<string, any>;
      net_pay: number;
    },
    payroll_data: {
      payroll_run_id: number;
      payroll_number: string;
      period_start: Date;
      period_end: Date;
    },
    predecessor: {
      cune: string;
      document_number: string;
      generation_date: string;
      adjustment_type: '1' | '2';
    },
  ): Promise<{
    success: boolean;
    tracking_id: string;
    cune?: string;
    xml?: string;
    message?: string;
  }> {
    const config = await this.loadPayrollConfig();
    const employer = await this.loadEmployerData(config);
    const cert_buffer = config.certificate_s3_key
      ? await this.s3_service.downloadImage(config.certificate_s3_key)
      : null;

    const item_number = `${payroll_data.payroll_number}A0001`;

    // Map employee data to DSPNE structures
    const worker = this.mapWorkerData(item);
    const earnings_data = this.mapEarnings(item);
    const deductions_data = this.mapDeductions(item);
    const payment = this.mapPayment(item);

    const total_earnings = this.sumEarnings(earnings_data);
    const total_deductions = this.sumDeductions(deductions_data);
    const net_amount = total_earnings - total_deductions;

    const period_start = this.formatDate(payroll_data.period_start);
    const period_end = this.formatDate(payroll_data.period_end);

    const nomina_data: NominaDocumentData = {
      prefix: 'NA',
      consecutive: item_number,
      period: {
        hire_date: worker.hire_date,
        settlement_start: period_start,
        settlement_end: period_end,
        worked_time: this.calculateWorkedTime(
          payroll_data.period_start,
          payroll_data.period_end,
        ),
        generation_date: this.formatDate(new Date()),
      },
      location: {
        country: DEFAULT_COUNTRY_CODE,
        department: employer.department,
        city: employer.city,
        language: DEFAULT_LANGUAGE,
      },
      employer,
      worker,
      payment,
      earnings: earnings_data,
      deductions: deductions_data,
      total_earnings,
      total_deductions,
      net_amount,
      payroll_period: '5',
    };

    const environment_code = config.environment === 'production' ? '1' : '2';

    // Build adjustment XML (tipo 103)
    const { xml, cune } = NominaAdjustmentBuilder.build(
      nomina_data,
      {
        software_id: config.software_id,
        software_pin: config.software_pin,
        nit: config.nit,
        nit_dv: config.nit_dv || '0',
        environment: environment_code,
      },
      predecessor,
    );

    // Sign XML
    let signed_xml = xml;
    if (cert_buffer && config.certificate_password) {
      signed_xml = await this.xml_signer.sign(
        xml,
        cert_buffer,
        config.certificate_password,
      );
    } else {
      this.logger.warn(
        'No certificate configured — sending unsigned adjustment XML',
      );
    }

    // ZIP + base64
    const filename = `NA${item_number}.xml`;
    const zip_base64 = this.compressToZipBase64(signed_xml, filename);

    // Load WS-Security credentials
    const ws_credentials = await this.loadWsCredentials(config);

    // Send to DIAN via SendNominaSync
    const dian_response = await this.soap_client.sendBillSync(
      zip_base64,
      `NA${item_number}.zip`,
      config.environment,
      ws_credentials,
    );

    const is_valid =
      dian_response.success || dian_response.status_code === '00';

    // Create audit log
    await this.createAuditLog(config.id, {
      action: 'send_payroll_adjustment',
      document_type: 'nomina_individual_ajuste',
      document_number: `NA${item_number}`,
      request_xml: signed_xml,
      response_xml: dian_response.raw_response,
      status: is_valid ? 'success' : 'error',
      error_message: is_valid ? null : dian_response.status_message,
      cufe: cune,
      duration_ms: 0,
    });

    return {
      success: is_valid,
      tracking_id: cune,
      cune,
      xml: signed_xml,
      message: is_valid
        ? 'Nota de ajuste de nomina aceptada por la DIAN'
        : `Nota de ajuste rechazada: ${dian_response.status_message}`,
    };
  }

  // ─── Private Helpers ───────────────────────────────────────

  /**
   * Processes a single employee's payroll document.
   * Builds XML, signs it, compresses, and sends to DIAN.
   */
  private async processEmployeePayroll(
    item: {
      employee_id: number;
      employee_code: string;
      document_type: string;
      document_number: string;
      first_name: string;
      last_name: string;
      base_salary: number;
      worked_days: number;
      earnings: Record<string, any>;
      deductions: Record<string, any>;
      employer_costs: Record<string, any>;
      net_pay: number;
    },
    payroll_data: {
      payroll_run_id: number;
      payroll_number: string;
      period_start: Date;
      period_end: Date;
    },
    item_number: string,
    config: DianConfigDecrypted,
    employer: NominaEmpleadorData,
    cert_buffer: Buffer | null,
  ): Promise<{
    success: boolean;
    tracking_id: string;
    cune?: string;
    xml?: string;
    message?: string;
  }> {
    // Map employee data to DSPNE structures
    const worker = this.mapWorkerData(item);
    const earnings_data = this.mapEarnings(item);
    const deductions_data = this.mapDeductions(item);
    const payment = this.mapPayment(item);

    // Calculate totals
    const total_earnings = this.sumEarnings(earnings_data);
    const total_deductions = this.sumDeductions(deductions_data);
    const net_amount = total_earnings - total_deductions;

    const period_start = this.formatDate(payroll_data.period_start);
    const period_end = this.formatDate(payroll_data.period_end);

    const nomina_data: NominaDocumentData = {
      prefix: 'NE',
      consecutive: item_number,
      period: {
        hire_date: worker.hire_date,
        settlement_start: period_start,
        settlement_end: period_end,
        worked_time: this.calculateWorkedTime(
          payroll_data.period_start,
          payroll_data.period_end,
        ),
        generation_date: this.formatDate(new Date()),
      },
      location: {
        country: DEFAULT_COUNTRY_CODE,
        department: employer.department,
        city: employer.city,
        language: DEFAULT_LANGUAGE,
      },
      employer,
      worker,
      payment,
      earnings: earnings_data,
      deductions: deductions_data,
      total_earnings,
      total_deductions,
      net_amount,
      payroll_period: '5', // Default: Mensual
    };

    const environment_code = config.environment === 'production' ? '1' : '2';

    // Build XML
    const { xml, cune } = NominaIndividualBuilder.build(nomina_data, {
      software_id: config.software_id,
      software_pin: config.software_pin,
      nit: config.nit,
      nit_dv: config.nit_dv || '0',
      environment: environment_code,
    });

    // Sign XML
    let signed_xml = xml;
    if (cert_buffer && config.certificate_password) {
      signed_xml = await this.xml_signer.sign(
        xml,
        cert_buffer,
        config.certificate_password,
      );
    } else {
      this.logger.warn(
        'No certificate configured — sending unsigned DSPNE XML',
      );
    }

    // ZIP + base64
    const filename = `NE${item_number}.xml`;
    const zip_base64 = this.compressToZipBase64(signed_xml, filename);

    // Load WS-Security credentials
    const ws_credentials = await this.loadWsCredentials(config);

    // Send to DIAN via SendNominaSync
    // SendNominaSync uses the same SOAP structure as SendBillSync
    const dian_response = await this.soap_client.sendBillSync(
      zip_base64,
      `NE${item_number}.zip`,
      config.environment,
      ws_credentials,
    );

    const is_valid =
      dian_response.success || dian_response.status_code === '00';

    // Create audit log
    await this.createAuditLog(config.id, {
      action: 'send_payroll',
      document_type: 'nomina_individual',
      document_number: `NE${item_number}`,
      request_xml: signed_xml,
      response_xml: dian_response.raw_response,
      status: is_valid ? 'success' : 'error',
      error_message: is_valid ? null : dian_response.status_message,
      cufe: cune,
      duration_ms: 0,
    });

    return {
      success: is_valid,
      tracking_id: cune,
      cune,
      xml: signed_xml,
      message: is_valid
        ? 'Documento de nomina aceptado por la DIAN'
        : `Documento rechazado: ${dian_response.status_message}`,
    };
  }

  /**
   * Loads and decrypts the DIAN configuration for payroll.
   */
  private async loadPayrollConfig(): Promise<DianConfigDecrypted> {
    const context = RequestContextService.getContext();
    if (!context?.organization_id) {
      throw new Error('Organization context required for DIAN payroll operations');
    }
    const accounting_entity =
      await this.fiscalScope.resolveAccountingEntityForFiscal({
        organization_id: context.organization_id,
        store_id: context.store_id ?? null,
      });

    const config = await this.prisma.dian_configurations.findFirst({
      where: {
        accounting_entity_id: accounting_entity.id,
        configuration_type: 'payroll',
        enablement_status: { in: ['testing', 'enabled'] },
      },
      orderBy: [{ is_default: 'desc' }, { created_at: 'desc' }],
    });

    if (!config) {
      throw new Error(
        `No active DIAN payroll configuration for fiscal entity ${accounting_entity.id}`,
      );
    }

    return {
      id: config.id,
      organization_id: config.organization_id,
      store_id: config.store_id,
      nit: config.nit,
      nit_dv: config.nit_dv,
      software_id: config.software_id,
      software_pin: this.encryption.decrypt(config.software_pin_encrypted),
      certificate_s3_key: config.certificate_s3_key,
      certificate_password: config.certificate_password_encrypted
        ? this.encryption.decrypt(config.certificate_password_encrypted)
        : null,
      certificate_expiry: config.certificate_expiry,
      environment: config.environment as 'test' | 'production',
      enablement_status: config.enablement_status,
      test_set_id: config.test_set_id,
    };
  }

  /**
   * Loads employer data from the organization.
   */
  private async loadEmployerData(
    config: DianConfigDecrypted,
  ): Promise<NominaEmpleadorData> {
    const org = await this.prisma.organizations.findUnique({
      where: { id: config.organization_id },
      include: { addresses: { take: 1 } },
    });

    if (!org) {
      throw new Error(`Organization ${config.organization_id} not found`);
    }

    const address = org.addresses?.[0];

    return {
      nit: config.nit,
      dv: config.nit_dv || '0',
      country: address?.country_code || DEFAULT_COUNTRY_CODE,
      department: address?.state_province || '11',
      city: address?.city || '11001',
      address: address?.address_line1 || 'N/A',
      legal_name: org.legal_name || org.name,
    };
  }

  /**
   * Extracts WS-Security credentials from the store's .p12 certificate.
   */
  private async loadWsCredentials(
    config: DianConfigDecrypted,
  ): Promise<WsSecurityCredentials | undefined> {
    if (!config.certificate_s3_key || !config.certificate_password) {
      return undefined;
    }
    const p12_buffer = await this.s3_service.downloadImage(
      config.certificate_s3_key,
    );
    const creds = this.xml_signer.extractCredentials(
      p12_buffer,
      config.certificate_password,
    );
    return {
      private_key_pem: creds.private_key_pem,
      certificate_der_base64: creds.certificate_der_base64,
    };
  }

  /**
   * Maps a payroll item's employee data to NominaTrabajadorData.
   */
  private mapWorkerData(item: {
    employee_code: string;
    document_type: string;
    document_number: string;
    first_name: string;
    last_name: string;
    base_salary: number;
    earnings: Record<string, any>;
  }): NominaTrabajadorData {
    const earnings = item.earnings || {};

    // Split last_name into first and second parts
    const last_name_parts = item.last_name.split(' ');
    const first_last_name = last_name_parts[0] || item.last_name;
    const second_last_name =
      last_name_parts.length > 1
        ? last_name_parts.slice(1).join(' ')
        : undefined;

    // Split first_name to extract other_names
    const first_name_parts = item.first_name.split(' ');
    const first_name = first_name_parts[0] || item.first_name;
    const other_names =
      first_name_parts.length > 1
        ? first_name_parts.slice(1).join(' ')
        : undefined;

    return {
      worker_type: WORKER_TYPE_MAP[earnings.worker_type || 'employee'] || '01',
      sub_type: earnings.sub_worker_type || '00',
      high_risk_pension: earnings.high_risk_pension || false,
      document_type:
        DOCUMENT_TYPE_MAP[item.document_type] || DOCUMENT_TYPE_MAP.CC,
      document_number: item.document_number,
      first_name,
      last_name: first_last_name,
      second_last_name,
      other_names,
      work_country: earnings.work_country || DEFAULT_COUNTRY_CODE,
      work_department: earnings.work_department || '11',
      work_city: earnings.work_city || '11001',
      work_address: earnings.work_address || 'N/A',
      integral_salary: earnings.integral_salary || false,
      contract_type:
        CONTRACT_TYPE_MAP[earnings.contract_type || 'indefinite'] || '2',
      salary: item.base_salary,
      employee_code: item.employee_code,
      hire_date: earnings.hire_date || this.formatDate(new Date()),
      termination_date: earnings.termination_date || undefined,
    };
  }

  /**
   * Maps a payroll item's earnings JSON to NominaDevengadosData.
   */
  private mapEarnings(item: {
    worked_days: number;
    base_salary: number;
    earnings: Record<string, any>;
  }): NominaDevengadosData {
    const earnings = item.earnings || {};

    const result: NominaDevengadosData = {
      worked_days: item.worked_days,
      base_salary:
        earnings.worked_salary != null
          ? Number(earnings.worked_salary)
          : (item.base_salary / 30) * item.worked_days,
      transport_subsidy: earnings.transport_subsidy
        ? Number(earnings.transport_subsidy)
        : undefined,
    };

    // Overtime
    if (earnings.overtime && Array.isArray(earnings.overtime)) {
      result.overtime = earnings.overtime.map((ot: any) => ({
        type: ot.type || 'HED',
        hours: Number(ot.hours || 0),
        percentage: Number(ot.percentage || 25),
        amount: Number(ot.amount || 0),
      }));
    }

    // Commissions
    if (earnings.commissions != null) {
      result.commissions = Number(earnings.commissions);
    }

    // Primas
    if (earnings.primas) {
      result.primas = {
        quantity: Number(earnings.primas.quantity || 0),
        payment: Number(earnings.primas.payment || 0),
        non_taxable_payment: earnings.primas.non_taxable_payment
          ? Number(earnings.primas.non_taxable_payment)
          : undefined,
      };
    }

    // Cesantias
    if (earnings.cesantias) {
      result.cesantias = {
        payment: Number(earnings.cesantias.payment || 0),
        percentage: Number(earnings.cesantias.percentage || 8.33),
        interest_payment: Number(earnings.cesantias.interest_payment || 0),
      };
    }

    // Vacaciones
    if (earnings.vacations && Array.isArray(earnings.vacations)) {
      result.vacations = earnings.vacations.map((v: any) => ({
        start_date: v.start_date,
        end_date: v.end_date,
        quantity: Number(v.quantity || 0),
        payment: Number(v.payment || 0),
      }));
    }

    // Bonificaciones
    if (earnings.bonuses && Array.isArray(earnings.bonuses)) {
      result.bonuses = earnings.bonuses.map((b: any) => ({
        taxable: Number(b.taxable || 0),
        non_taxable: Number(b.non_taxable || 0),
      }));
    }

    return result;
  }

  /**
   * Maps a payroll item's deductions JSON to NominaDeduccionesData.
   */
  private mapDeductions(item: {
    deductions: Record<string, any>;
  }): NominaDeduccionesData {
    const deductions = item.deductions || {};

    return {
      health_pct: Number(deductions.health_pct || 4),
      health_amount: Number(deductions.health_amount || 0),
      pension_pct: Number(deductions.pension_pct || 4),
      pension_amount: Number(deductions.pension_amount || 0),
      solidarity_fund_pct: deductions.solidarity_fund_pct
        ? Number(deductions.solidarity_fund_pct)
        : undefined,
      solidarity_fund_amount: deductions.solidarity_fund_amount
        ? Number(deductions.solidarity_fund_amount)
        : undefined,
      subsistence_fund_pct: deductions.subsistence_fund_pct
        ? Number(deductions.subsistence_fund_pct)
        : undefined,
      subsistence_fund_amount: deductions.subsistence_fund_amount
        ? Number(deductions.subsistence_fund_amount)
        : undefined,
      retention: deductions.retention
        ? Number(deductions.retention)
        : undefined,
      other_deductions: deductions.other_deductions || undefined,
    };
  }

  /**
   * Maps payment method from item's earnings or uses defaults.
   */
  private mapPayment(item: { earnings: Record<string, any> }): NominaPagoData {
    const earnings = item.earnings || {};

    return {
      form: earnings.payment_form || '1', // 1 = contado
      method:
        PAYMENT_METHOD_MAP[earnings.payment_method || 'bank_transfer'] || '47',
      payment_dates: [this.formatDate(new Date())],
    };
  }

  /**
   * Sums all earnings values to compute DevengadosTotal.
   */
  private sumEarnings(earnings: NominaDevengadosData): number {
    let total = earnings.base_salary;

    if (earnings.transport_subsidy) total += earnings.transport_subsidy;
    if (earnings.travel_allowance_taxable)
      total += earnings.travel_allowance_taxable;
    if (earnings.travel_allowance_non_taxable)
      total += earnings.travel_allowance_non_taxable;
    if (earnings.commissions) total += earnings.commissions;

    if (earnings.overtime) {
      for (const ot of earnings.overtime) {
        total += ot.amount;
      }
    }
    if (earnings.bonuses) {
      for (const b of earnings.bonuses) {
        total += b.taxable + b.non_taxable;
      }
    }
    if (earnings.primas) {
      total += earnings.primas.payment;
      if (earnings.primas.non_taxable_payment)
        total += earnings.primas.non_taxable_payment;
    }
    if (earnings.cesantias) {
      total += earnings.cesantias.payment;
      total += earnings.cesantias.interest_payment;
    }
    if (earnings.vacations) {
      for (const v of earnings.vacations) {
        total += v.payment;
      }
    }
    if (earnings.disabilities) {
      for (const d of earnings.disabilities) {
        total += d.payment;
      }
    }
    if (earnings.licenses) {
      for (const l of earnings.licenses) {
        total += l.payment;
      }
    }

    return total;
  }

  /**
   * Sums all deduction values to compute DeduccionesTotal.
   */
  private sumDeductions(deductions: NominaDeduccionesData): number {
    let total = deductions.health_amount + deductions.pension_amount;

    if (deductions.solidarity_fund_amount)
      total += deductions.solidarity_fund_amount;
    if (deductions.subsistence_fund_amount)
      total += deductions.subsistence_fund_amount;
    if (deductions.retention) total += deductions.retention;

    if (deductions.other_deductions) {
      for (const d of deductions.other_deductions) {
        total += d.amount;
      }
    }

    return total;
  }

  /**
   * Compresses XML to ZIP and encodes as base64.
   * Reuses the minimal ZIP structure pattern from DianDirectProvider.
   */
  private compressToZipBase64(xml_content: string, filename: string): string {
    const xml_buffer = Buffer.from(xml_content, 'utf-8');
    const compressed = zlib.deflateRawSync(xml_buffer);
    const zip = this.buildMinimalZip(filename, xml_buffer, compressed);
    return zip.toString('base64');
  }

  /**
   * Builds a minimal valid ZIP file with a single entry.
   */
  private buildMinimalZip(
    filename: string,
    uncompressed: Buffer,
    compressed: Buffer,
  ): Buffer {
    const filename_buffer = Buffer.from(filename, 'utf-8');
    const crc = this.crc32(uncompressed);

    // Local file header
    const local_header = Buffer.alloc(30 + filename_buffer.length);
    local_header.writeUInt32LE(0x04034b50, 0); // signature
    local_header.writeUInt16LE(20, 4); // version needed
    local_header.writeUInt16LE(0, 6); // flags
    local_header.writeUInt16LE(8, 8); // compression: deflate
    local_header.writeUInt16LE(0, 10); // mod time
    local_header.writeUInt16LE(0, 12); // mod date
    local_header.writeUInt32LE(crc, 14); // crc32
    local_header.writeUInt32LE(compressed.length, 18); // compressed size
    local_header.writeUInt32LE(uncompressed.length, 22); // uncompressed size
    local_header.writeUInt16LE(filename_buffer.length, 26); // name length
    local_header.writeUInt16LE(0, 28); // extra length
    filename_buffer.copy(local_header, 30);

    // Central directory
    const central = Buffer.alloc(46 + filename_buffer.length);
    central.writeUInt32LE(0x02014b50, 0); // signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(8, 10); // compression
    central.writeUInt16LE(0, 12); // mod time
    central.writeUInt16LE(0, 14); // mod date
    central.writeUInt32LE(crc, 16); // crc32
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(uncompressed.length, 24);
    central.writeUInt16LE(filename_buffer.length, 28);
    central.writeUInt16LE(0, 30); // extra length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk start
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(0, 42); // offset
    filename_buffer.copy(central, 46);

    const data_offset = local_header.length + compressed.length;

    // End of central directory
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); // signature
    eocd.writeUInt16LE(0, 4); // disk
    eocd.writeUInt16LE(0, 6); // disk with central
    eocd.writeUInt16LE(1, 8); // entries on disk
    eocd.writeUInt16LE(1, 10); // total entries
    eocd.writeUInt32LE(central.length, 12); // central size
    eocd.writeUInt32LE(data_offset, 16); // central offset
    eocd.writeUInt16LE(0, 20); // comment length

    return Buffer.concat([local_header, compressed, central, eocd]);
  }

  /**
   * CRC-32 implementation for ZIP.
   */
  private crc32(buffer: Buffer): number {
    let crc = 0xffffffff;
    for (const byte of buffer) {
      crc ^= byte;
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  /**
   * Formats a Date to YYYY-MM-DD string.
   */
  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  /**
   * Calculates worked time as ISO 8601 duration between two dates.
   * Example: 30 days = "P30D"
   */
  private calculateWorkedTime(start: Date, end: Date): string {
    const diff_ms = end.getTime() - start.getTime();
    const diff_days = Math.ceil(diff_ms / (1000 * 60 * 60 * 24));
    return `P${diff_days}D`;
  }

  /**
   * Creates an audit log entry for a DIAN payroll operation.
   */
  private async createAuditLog(
    dian_configuration_id: number,
    data: {
      action: string;
      document_type?: string;
      document_number?: string;
      request_xml?: string;
      response_xml?: string;
      status: string;
      error_message?: string | null;
      cufe?: string;
      duration_ms?: number;
    },
  ): Promise<void> {
    try {
      await this.prisma.dian_audit_logs.create({
        data: {
          dian_configuration_id,
          ...data,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to create DIAN payroll audit log: ${error.message}`,
      );
    }
  }
}
