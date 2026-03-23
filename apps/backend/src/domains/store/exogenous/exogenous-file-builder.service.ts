import { Injectable, Logger } from '@nestjs/common';
import { S3Service } from '@common/services/s3.service';
import { EXOGENOUS_FORMATS, ExogenousFormatCode } from './constants/format-definitions';

/**
 * Columnas fijas DIAN para medios magneticos
 * Cada formato tiene su estructura especifica de columnas
 */
interface DianColumnDef {
  name: string;
  width: number;
  align: 'left' | 'right';
  pad_char?: string;
}

const DIAN_COLUMNS: Record<string, DianColumnDef[]> = {
  // Estructura comun para formatos 1001, 1003, 1005, 1006, 1007
  default: [
    { name: 'concepto', width: 4, align: 'right', pad_char: '0' },
    { name: 'tipo_documento', width: 2, align: 'right', pad_char: '0' },
    { name: 'nit', width: 16, align: 'right', pad_char: ' ' },
    { name: 'dv', width: 1, align: 'right', pad_char: ' ' },
    { name: 'primer_apellido', width: 60, align: 'left' },
    { name: 'segundo_apellido', width: 60, align: 'left' },
    { name: 'primer_nombre', width: 60, align: 'left' },
    { name: 'otros_nombres', width: 60, align: 'left' },
    { name: 'razon_social', width: 450, align: 'left' },
    { name: 'direccion', width: 200, align: 'left' },
    { name: 'codigo_dpto', width: 2, align: 'right', pad_char: '0' },
    { name: 'codigo_mpio', width: 3, align: 'right', pad_char: '0' },
    { name: 'pais', width: 4, align: 'left' },
    { name: 'email', width: 100, align: 'left' },
    { name: 'valor_pago', width: 16, align: 'right', pad_char: '0' },
    { name: 'valor_iva', width: 16, align: 'right', pad_char: '0' },
    { name: 'valor_retencion', width: 16, align: 'right', pad_char: '0' },
  ],
  // Formatos 1008/1009 — saldos contables
  balance: [
    { name: 'concepto', width: 4, align: 'right', pad_char: '0' },
    { name: 'cuenta_contable', width: 10, align: 'left' },
    { name: 'nombre_cuenta', width: 200, align: 'left' },
    { name: 'saldo', width: 16, align: 'right', pad_char: '0' },
  ],
};

@Injectable()
export class ExogenousFileBuilderService {
  private readonly logger = new Logger(ExogenousFileBuilderService.name);

  constructor(private readonly s3_service: S3Service) {}

  /**
   * Genera el contenido TXT en formato de columnas fijas DIAN
   */
  buildTxtContent(format_code: string, lines: any[]): string {
    if (lines.length === 0) return '';

    const is_balance_format = ['1008', '1009'].includes(format_code);
    const columns = is_balance_format ? DIAN_COLUMNS.balance : DIAN_COLUMNS.default;

    const rows: string[] = [];

    for (const line of lines) {
      if (is_balance_format) {
        rows.push(this.buildBalanceLine(columns, line, format_code));
      } else {
        rows.push(this.buildDefaultLine(columns, line, format_code));
      }
    }

    return rows.join('\r\n');
  }

  /**
   * Genera TXT, sube a S3, retorna file_key
   */
  async buildAndUpload(
    organization_id: number,
    report_id: number,
    format_code: string,
    fiscal_year: number,
    lines: any[],
  ): Promise<string> {
    const content = this.buildTxtContent(format_code, lines);
    const buffer = Buffer.from(content, 'utf-8');

    const file_key = `exogenous/${organization_id}/${fiscal_year}/formato_${format_code}_${report_id}.txt`;

    await this.s3_service.uploadFile(buffer, file_key, 'text/plain; charset=utf-8');

    this.logger.log(`Exogenous TXT uploaded: ${file_key} (${lines.length} lines)`);

    return file_key;
  }

  /**
   * Obtiene URL firmada para descarga
   */
  async getDownloadUrl(file_key: string): Promise<string> {
    return this.s3_service.getPresignedUrl(file_key, 3600); // 1 hora
  }

  // ═══ Private helpers ═══

  private buildDefaultLine(columns: DianColumnDef[], line: any, format_code: string): string {
    const concept_code = this.mapConceptCode(line.concept_code, format_code);
    const names = this.splitName(line.third_party_name);

    const values: Record<string, string> = {
      concepto: concept_code,
      tipo_documento: '31', // NIT por defecto
      nit: line.third_party_nit || '',
      dv: line.third_party_dv || '',
      primer_apellido: names.primer_apellido,
      segundo_apellido: names.segundo_apellido,
      primer_nombre: names.primer_nombre,
      otros_nombres: names.otros_nombres,
      razon_social: line.third_party_name || '',
      direccion: '',
      codigo_dpto: '',
      codigo_mpio: '',
      pais: '169', // Colombia
      email: '',
      valor_pago: this.formatAmount(line.payment_amount),
      valor_iva: this.formatAmount(line.tax_amount),
      valor_retencion: this.formatAmount(line.withholding_amount),
    };

    return this.formatRow(columns, values);
  }

  private buildBalanceLine(columns: DianColumnDef[], line: any, format_code: string): string {
    const account_code = line.line_data?.account_code || line.concept_code || '';
    const account_name = line.line_data?.account_name || line.third_party_name || '';

    const values: Record<string, string> = {
      concepto: format_code,
      cuenta_contable: account_code,
      nombre_cuenta: account_name,
      saldo: this.formatAmount(line.payment_amount),
    };

    return this.formatRow(columns, values);
  }

  private formatRow(columns: DianColumnDef[], values: Record<string, string>): string {
    return columns
      .map((col) => {
        const raw = (values[col.name] || '').toString();
        const cleaned = this.sanitizeText(raw);
        return this.padField(cleaned, col.width, col.align, col.pad_char);
      })
      .join('|');
  }

  private padField(value: string, width: number, align: 'left' | 'right', pad_char = ' '): string {
    const truncated = value.substring(0, width);
    if (align === 'left') {
      return truncated.padEnd(width, pad_char);
    }
    return truncated.padStart(width, pad_char);
  }

  private formatAmount(amount: number | null | undefined): string {
    if (!amount || isNaN(amount)) return '0';
    return Math.round(amount).toString();
  }

  private sanitizeText(text: string): string {
    return text
      .replace(/[\r\n\t|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Mapea concept_code interno a concepto DIAN numerico
   */
  private mapConceptCode(concept_code: string, format_code: string): string {
    // Si ya es numerico, usarlo directamente
    if (/^\d+$/.test(concept_code)) return concept_code;

    // Mapeos por formato
    const mappings: Record<string, Record<string, string>> = {
      '1001': { RTE_FUENTE: '5001', RTE_IVA: '5002', RTE_ICA: '5003', RTE_OTROS: '5004' },
      '1003': { RTE_FUENTE: '5001', RTE_IVA: '5002', RTE_ICA: '5003', RTE_OTROS: '5004' },
      '1005': { IVA_GENERADO: '5005', IVA_DESCONTABLE: '5006' },
      '1006': { IVA_REGIMEN_SIMPLE: '5007' },
      '1007': { INGRESOS: '4001' },
    };

    return mappings[format_code]?.[concept_code] || concept_code;
  }

  /**
   * Intenta separar un nombre completo en componentes
   * Para personas naturales; para juridicas se usa razon_social
   */
  private splitName(full_name: string): {
    primer_apellido: string;
    segundo_apellido: string;
    primer_nombre: string;
    otros_nombres: string;
  } {
    if (!full_name) {
      return { primer_apellido: '', segundo_apellido: '', primer_nombre: '', otros_nombres: '' };
    }

    const parts = full_name.trim().split(/\s+/);

    if (parts.length === 1) {
      return { primer_apellido: '', segundo_apellido: '', primer_nombre: parts[0], otros_nombres: '' };
    }

    if (parts.length === 2) {
      return { primer_apellido: parts[1], segundo_apellido: '', primer_nombre: parts[0], otros_nombres: '' };
    }

    if (parts.length === 3) {
      return { primer_apellido: parts[1], segundo_apellido: parts[2], primer_nombre: parts[0], otros_nombres: '' };
    }

    // 4+ parts
    return {
      primer_apellido: parts[parts.length - 2],
      segundo_apellido: parts[parts.length - 1],
      primer_nombre: parts[0],
      otros_nombres: parts.slice(1, parts.length - 2).join(' '),
    };
  }
}
