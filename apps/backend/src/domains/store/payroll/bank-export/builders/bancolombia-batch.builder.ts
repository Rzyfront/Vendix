import {
  BankBatchBuilder,
  BankBatchEmployee,
  BankBatchMetadata,
  BankBatchResult,
} from '../interfaces/bank-batch-builder.interface';

/**
 * Bancolombia PAB format builder.
 * Each line is exactly 264 characters, separated by CRLF (\r\n).
 * Header = record type 1, Detail = record type 6.
 */

// Comprehensive map of Colombian bank names to 2-digit PAB codes
const BANK_NAME_TO_CODE: Record<string, string> = {
  // Full names
  'banco de bogota': '01',
  'banco de bogotá': '01',
  'banco popular': '02',
  bancolombia: '07',
  citibank: '09',
  'gnb sudameris': '12',
  'banco gnb': '12',
  bbva: '13',
  'bbva colombia': '13',
  colpatria: '19',
  'scotiabank colpatria': '19',
  'banco de occidente': '23',
  occidente: '23',
  bcsc: '32',
  'banco caja social': '32',
  'caja social': '32',
  'banco agrario': '40',
  agrario: '40',
  'banco agrario de colombia': '40',
  'banco mundo mujer': '47',
  'mundo mujer': '47',
  mundomujer: '47',
  davivienda: '51',
  'av villas': '52',
  'banco av villas': '52',
  ban100: '58',
  'banco ban100': '58',
  bancamia: '59',
  'banco bancamia': '59',
  pichincha: '60',
  'banco pichincha': '60',
  bancoomeva: '61',
  'banco bancoomeva': '61',
  falabella: '62',
  'banco falabella': '62',
  finandina: '63',
  'banco finandina': '63',
  santander: '65',
  'banco santander': '65',
  coopcentral: '66',
  'banco coopcentral': '66',
  mibanco: '67',
  'banco mibanco': '67',
  serfinanza: '69',
  'banco serfinanza': '69',
  lulo: '70',
  lulobank: '70',
  'lulo bank': '70',
  // Common abbreviations
  bogota: '01',
  bogotá: '01',
  popular: '02',
  gnb: '12',
};

export class BancolombiaBatchBuilder implements BankBatchBuilder {
  bankCode = 'bancolombia';
  bankName = 'Bancolombia';

  build(
    metadata: BankBatchMetadata,
    employees: BankBatchEmployee[],
  ): BankBatchResult {
    const lines: string[] = [];

    // Header line (record type 1)
    lines.push(this.buildHeader(metadata, employees));

    // Detail lines (record type 6)
    for (const employee of employees) {
      lines.push(this.buildDetail(employee, metadata.payment_date));
    }

    const file_content = Buffer.from(lines.join('\r\n') + '\r\n', 'latin1');
    const timestamp = this.formatTimestamp(new Date());
    const nit = metadata.company_nit.replace(/[^0-9]/g, '');
    const file_name = `PAB${nit}${timestamp}.txt`;

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

      if (!emp.net_pay || emp.net_pay <= 0) {
        errors.push(`${name}: invalid net pay amount`);
      }
    }

    return errors;
  }

  // --- Header (264 chars) ---

  private buildHeader(
    metadata: BankBatchMetadata,
    employees: BankBatchEmployee[],
  ): string {
    const nit = metadata.company_nit.replace(/[^0-9]/g, '');
    const date_str = this.formatDate(metadata.payment_date);
    const total = employees.reduce((sum, e) => sum + e.net_pay, 0);

    let line = '';
    line += '1'; // Pos 1: Record Type
    line += this.padLeft(nit, 15); // Pos 2-16: Payer NIT
    line += 'I'; // Pos 17: Transmission Type (Immediate)
    line += this.padRight('', 15); // Pos 18-32: Filler
    line += '225'; // Pos 33-35: Payment Type (Payroll)
    line += this.padRight('NOMINA', 10); // Pos 36-45: Description
    line += date_str; // Pos 46-53: Transmission Date
    line += '1'; // Pos 54: Send Sequence
    line += date_str; // Pos 55-62: Application Date
    line += this.padLeft(String(employees.length), 6); // Pos 63-68: Record Count
    line += this.padLeft('0', 17); // Pos 69-85: Debit Sum (zeros)
    line += this.formatAmount(total, 17); // Pos 86-102: Credit Sum
    line += this.padLeft(metadata.source_account.replace(/[^0-9]/g, ''), 11); // Pos 103-113: Debit Account
    line += this.mapAccountType(metadata.source_account_type); // Pos 114-115: Account Type
    line += this.padRight('', 149); // Pos 116-264: Filler

    return line;
  }

  // --- Detail (264 chars) ---

  private buildDetail(employee: BankBatchEmployee, payment_date: Date): string {
    const date_str = this.formatDate(payment_date);
    const bank_code = this.mapBankCode(employee.bank_name) || '00';

    let line = '';
    line += '6'; // Pos 1: Record Type
    line += this.padRight(employee.document_number, 15); // Pos 2-16: Beneficiary Doc
    line += this.padRight(
      this.stripAccents(
        `${employee.first_name} ${employee.last_name}`,
      ).substring(0, 30),
      30,
    ); // Pos 17-46: Beneficiary Name
    line += bank_code; // Pos 47-48: Bank Code
    line += this.padRight(employee.bank_account_number, 17); // Pos 49-65: Account Number
    line += this.mapAccountType(employee.bank_account_type); // Pos 66-67: Account Type
    line += this.formatAmount(employee.net_pay, 17); // Pos 68-84: Amount
    line += date_str; // Pos 85-92: Application Date
    line += this.padRight(employee.employee_code, 21); // Pos 93-113: Reference
    line += this.padRight('', 151); // Pos 114-264: Filler

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

  private formatTimestamp(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const mi = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return `${y}${m}${d}${h}${mi}${s}`;
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
      case 'savings':
        return 'S ';
      case 'checking':
        return 'D ';
      default:
        return 'S ';
    }
  }
}
