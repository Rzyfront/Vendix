import {
  BankBatchBuilder,
  BankBatchEmployee,
  BankBatchMetadata,
  BankBatchResult,
} from '../interfaces/bank-batch-builder.interface';

/**
 * Davivienda flat-file format builder.
 * Control record (RC) = 90 chars, Transfer record (TR) = 160 chars.
 * Lines separated by CRLF (\r\n).
 */

// Davivienda uses 6-digit bank codes
const BANK_NAME_TO_CODE: Record<string, string> = {
  'banco de bogota': '000001',
  'banco de bogotá': '000001',
  bogota: '000001',
  'bogotá': '000001',
  'banco popular': '000002',
  popular: '000002',
  bancolombia: '000007',
  bbva: '000013',
  'bbva colombia': '000013',
  colpatria: '000019',
  'scotiabank colpatria': '000019',
  'banco de occidente': '000023',
  occidente: '000023',
  davivienda: '000051',
  'av villas': '000052',
  'banco av villas': '000052',
  // Additional common banks
  citibank: '000009',
  'gnb sudameris': '000012',
  'banco gnb': '000012',
  gnb: '000012',
  'banco caja social': '000032',
  bcsc: '000032',
  'caja social': '000032',
  'banco agrario': '000040',
  agrario: '000040',
  'mundo mujer': '000047',
  mundomujer: '000047',
  ban100: '000058',
  bancamia: '000059',
  pichincha: '000060',
  bancoomeva: '000061',
  falabella: '000062',
  finandina: '000063',
  santander: '000065',
  coopcentral: '000066',
  mibanco: '000067',
  serfinanza: '000069',
  lulobank: '000070',
  'lulo bank': '000070',
  lulo: '000070',
};

const DOC_TYPE_MAP: Record<string, string> = {
  cc: '01',
  cedula: '01',
  'cedula de ciudadania': '01',
  ce: '02',
  'cedula de extranjeria': '02',
  nit: '03',
  ti: '04',
  'tarjeta de identidad': '04',
  pp: '05',
  pasaporte: '05',
  passport: '05',
};

export class DaviviendaBatchBuilder implements BankBatchBuilder {
  bankCode = 'davivienda';
  bankName = 'Davivienda';

  build(metadata: BankBatchMetadata, employees: BankBatchEmployee[]): BankBatchResult {
    const lines: string[] = [];

    // Control record (RC)
    lines.push(this.buildControlRecord(metadata, employees));

    // Transfer records (TR)
    for (const employee of employees) {
      lines.push(this.buildTransferRecord(employee, metadata));
    }

    const file_content = Buffer.from(lines.join('\r\n') + '\r\n', 'latin1');
    const nit = metadata.company_nit.replace(/[^0-9]/g, '');
    const date_str = this.formatDate(metadata.payment_date);
    const file_name = `DAV_NOMINA_${nit}_${date_str}.txt`;

    return {
      file_content,
      file_name,
      mime_type: 'text/plain',
      record_count: employees.length,
      total_amount: metadata.total_amount,
    };
  }

  validate(employees: BankBatchEmployee[]): string[] {
    const errors: string[] = [];

    for (const emp of employees) {
      const name = `${emp.first_name} ${emp.last_name} (${emp.employee_code})`;

      if (!emp.bank_account_number) {
        errors.push(`${name}: missing bank account number`);
      }

      if (!emp.bank_account_type) {
        errors.push(`${name}: missing bank account type`);
      }

      if (!emp.bank_name) {
        errors.push(`${name}: missing bank name`);
      } else {
        const code = this.mapBankCode(emp.bank_name);
        if (!code) {
          errors.push(`${name}: unknown bank "${emp.bank_name}"`);
        }
      }

      if (!emp.document_type) {
        errors.push(`${name}: missing document type`);
      } else {
        const doc_code = this.mapDocumentType(emp.document_type);
        if (!doc_code) {
          errors.push(`${name}: unknown document type "${emp.document_type}"`);
        }
      }

      if (!emp.document_number) {
        errors.push(`${name}: missing document number`);
      }

      if (!emp.net_pay || emp.net_pay <= 0) {
        errors.push(`${name}: invalid net pay amount`);
      }
    }

    return errors;
  }

  // --- Control Record (RC - 90 chars) ---

  private buildControlRecord(metadata: BankBatchMetadata, employees: BankBatchEmployee[]): string {
    const nit = metadata.company_nit.replace(/[^0-9]/g, '');
    const total = employees.reduce((sum, e) => sum + e.net_pay, 0);
    const date_str = this.formatDate(metadata.payment_date);

    let line = '';
    line += 'RC';                                                          // Pos 1-2: Record Type
    line += this.padLeft(nit, 16);                                         // Pos 3-18: Company NIT
    line += this.padRight(this.stripAccents(metadata.company_name).substring(0, 16), 16); // Pos 19-34: Company Name
    line += this.mapAccountType(metadata.source_account_type);             // Pos 35-36: Source Account Type
    line += this.padLeft(metadata.source_account.replace(/[^0-9]/g, ''), 16); // Pos 37-52: Source Account Number
    line += this.padLeft(String(employees.length), 6);                     // Pos 53-58: Record Count
    line += this.formatAmount(total, 18);                                  // Pos 59-76: Total Amount
    line += date_str;                                                      // Pos 77-84: Payment Date
    line += this.padLeft('1', 6);                                          // Pos 85-90: File Sequence

    return line;
  }

  // --- Transfer Record (TR - 160 chars) ---

  private buildTransferRecord(employee: BankBatchEmployee, metadata: BankBatchMetadata): string {
    const doc_number = employee.document_number.replace(/[^0-9]/g, '');
    const bank_code = this.mapBankCode(employee.bank_name) || '000000';
    const doc_type = this.mapDocumentType(employee.document_type) || '01';
    const full_name = this.stripAccents(`${employee.first_name} ${employee.last_name}`);

    let line = '';
    line += 'TR';                                                          // Pos 1-2: Record Type
    line += this.padLeft(doc_number, 16);                                  // Pos 3-18: Beneficiary NIT
    line += this.padLeft('0', 16);                                         // Pos 19-34: Reference (zeros)
    line += this.padLeft(employee.bank_account_number.replace(/[^0-9]/g, ''), 16); // Pos 35-50: Dest Account
    line += this.mapAccountType(employee.bank_account_type);               // Pos 51-52: Dest Account Type
    line += bank_code;                                                     // Pos 53-58: Bank Code
    line += this.formatAmount(employee.net_pay, 18);                       // Pos 59-76: Amount
    line += this.padLeft('0', 6);                                          // Pos 77-82: Voucher (zeros)
    line += doc_type;                                                      // Pos 83-84: Doc Type
    line += this.padLeft(doc_number, 16);                                  // Pos 85-100: Doc Number
    line += this.padRight(full_name.substring(0, 30), 30);                 // Pos 101-130: Beneficiary Name
    line += this.padRight(this.stripAccents(`NOMINA ${metadata.payroll_number}`).substring(0, 30), 30); // Pos 131-160: Concept

    return line;
  }

  // --- Helpers ---

  private padLeft(str: string, len: number, char = '0'): string {
    return str.slice(0, len).padStart(len, char);
  }

  private padRight(str: string, len: number, char = ' '): string {
    return str.slice(0, len).padEnd(len, char);
  }

  private formatAmount(amount: number, len: number): string {
    const cents = Math.round(amount * 100);
    return this.padLeft(String(cents), len);
  }

  private formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }

  private stripAccents(str: string): string {
    return str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9 ]/g, '')
      .toUpperCase();
  }

  private mapBankCode(bank_name: string): string | null {
    const normalized = bank_name
      .toLowerCase()
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    return BANK_NAME_TO_CODE[normalized] || null;
  }

  private mapAccountType(type: string): string {
    switch (type?.toLowerCase()) {
      case 'checking':
        return '00';
      case 'savings':
        return '01';
      default:
        return '01';
    }
  }

  private mapDocumentType(doc_type: string): string | null {
    const normalized = doc_type
      .toLowerCase()
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    return DOC_TYPE_MAP[normalized] || null;
  }
}
