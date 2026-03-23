import PDFDocument from 'pdfkit';

export interface PaystubData {
  company_name: string;
  company_nit: string;
  company_logo_buffer?: Buffer;
  employee_name: string;
  employee_code: string;
  document_type: string;
  document_number: string;
  position?: string;
  department?: string;
  period_start: string;
  period_end: string;
  payment_date?: string;
  payroll_number: string;
  earnings: { label: string; value: number }[];
  deductions: { label: string; value: number }[];
  total_earnings: number;
  total_deductions: number;
  net_pay: number;
}

export interface SettlementPaystubData {
  company_name: string;
  company_nit: string;
  company_logo_buffer?: Buffer;
  employee_name: string;
  employee_code: string;
  document_type: string;
  document_number: string;
  position?: string;
  department?: string;
  hire_date: string;
  termination_date: string;
  termination_reason: string;
  settlement_number: string;
  days_worked: number;
  base_salary: number;
  severance: number;
  severance_interest: number;
  bonus: number;
  vacation: number;
  pending_salary: number;
  indemnification: number;
  health_deduction: number;
  pension_deduction: number;
  other_deductions: number;
  gross_settlement: number;
  total_deductions: number;
  net_settlement: number;
}

const COP = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  minimumFractionDigits: 0,
});

const MARGIN = 50;
const PAGE_WIDTH = 612; // Letter size
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const COL_LABEL_X = MARGIN;
const COL_VALUE_X = PAGE_WIDTH - MARGIN;

export class PaystubPdfBuilder {
  /**
   * Generates a payroll paystub PDF for a single payroll item.
   */
  static async generatePaystub(data: PaystubData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'LETTER', margin: MARGIN });
        const chunks: Buffer[] = [];

        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        // --- Header ---
        this.drawHeader(doc, data.company_name, data.company_nit, data.company_logo_buffer);

        // --- Title ---
        doc.moveDown(0.5);
        doc
          .font('Helvetica-Bold')
          .fontSize(14)
          .text('COMPROBANTE DE PAGO DE NOMINA', MARGIN, doc.y, {
            align: 'center',
            width: CONTENT_WIDTH,
          });

        doc
          .font('Helvetica')
          .fontSize(9)
          .text(
            `Periodo ${data.period_start} - ${data.period_end}  |  Nomina #${data.payroll_number}`,
            MARGIN,
            doc.y + 4,
            { align: 'center', width: CONTENT_WIDTH },
          );

        if (data.payment_date) {
          doc.text(`Fecha de pago: ${data.payment_date}`, MARGIN, doc.y + 2, {
            align: 'center',
            width: CONTENT_WIDTH,
          });
        }

        doc.moveDown(1);
        this.drawHorizontalLine(doc);

        // --- Employee Info ---
        doc.moveDown(0.5);
        this.drawSectionTitle(doc, 'DATOS DEL EMPLEADO');

        const info_y = doc.y;
        const half = CONTENT_WIDTH / 2;

        doc.font('Helvetica').fontSize(9);
        doc.text(`Nombre: ${data.employee_name}`, MARGIN, info_y);
        doc.text(`Codigo: ${data.employee_code}`, MARGIN + half, info_y);

        const row2_y = doc.y + 2;
        doc.text(
          `Documento: ${data.document_type} ${data.document_number}`,
          MARGIN,
          row2_y,
        );
        if (data.position) {
          doc.text(`Cargo: ${data.position}`, MARGIN + half, row2_y);
        }

        if (data.department) {
          const row3_y = doc.y + 2;
          doc.text(`Departamento: ${data.department}`, MARGIN, row3_y);
        }

        doc.moveDown(1);
        this.drawHorizontalLine(doc);

        // --- Earnings Table ---
        doc.moveDown(0.5);
        this.drawSectionTitle(doc, 'DEVENGADOS');
        this.drawConceptTable(doc, data.earnings);

        doc.moveDown(0.5);
        this.drawHorizontalLine(doc);

        // --- Deductions Table ---
        doc.moveDown(0.5);
        this.drawSectionTitle(doc, 'DEDUCCIONES');
        this.drawConceptTable(doc, data.deductions);

        doc.moveDown(0.5);
        this.drawHorizontalLine(doc);

        // --- Totals ---
        doc.moveDown(0.8);
        this.drawTotals(doc, [
          { label: 'Total Devengados', value: data.total_earnings },
          { label: 'Total Deducciones', value: data.total_deductions },
        ]);

        doc.moveDown(0.5);
        this.drawNetPay(doc, data.net_pay);

        // --- Footer ---
        this.drawFooter(doc);

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Generates a settlement (liquidacion) paystub PDF.
   */
  static async generateSettlementPaystub(
    data: SettlementPaystubData,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'LETTER', margin: MARGIN });
        const chunks: Buffer[] = [];

        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        // --- Header ---
        this.drawHeader(doc, data.company_name, data.company_nit, data.company_logo_buffer);

        // --- Title ---
        doc.moveDown(0.5);
        doc
          .font('Helvetica-Bold')
          .fontSize(14)
          .text('COMPROBANTE DE LIQUIDACION', MARGIN, doc.y, {
            align: 'center',
            width: CONTENT_WIDTH,
          });

        doc
          .font('Helvetica')
          .fontSize(9)
          .text(`Liquidacion #${data.settlement_number}`, MARGIN, doc.y + 4, {
            align: 'center',
            width: CONTENT_WIDTH,
          });

        doc.moveDown(1);
        this.drawHorizontalLine(doc);

        // --- Employee Info ---
        doc.moveDown(0.5);
        this.drawSectionTitle(doc, 'DATOS DEL EMPLEADO');

        const half = CONTENT_WIDTH / 2;
        doc.font('Helvetica').fontSize(9);

        let y = doc.y;
        doc.text(`Nombre: ${data.employee_name}`, MARGIN, y);
        doc.text(`Codigo: ${data.employee_code}`, MARGIN + half, y);

        y = doc.y + 2;
        doc.text(
          `Documento: ${data.document_type} ${data.document_number}`,
          MARGIN,
          y,
        );
        if (data.position) {
          doc.text(`Cargo: ${data.position}`, MARGIN + half, y);
        }
        if (data.department) {
          y = doc.y + 2;
          doc.text(`Departamento: ${data.department}`, MARGIN, y);
        }

        doc.moveDown(1);
        this.drawHorizontalLine(doc);

        // --- Employment Info ---
        doc.moveDown(0.5);
        this.drawSectionTitle(doc, 'INFORMACION LABORAL');

        doc.font('Helvetica').fontSize(9);
        y = doc.y;
        doc.text(`Fecha de ingreso: ${data.hire_date}`, MARGIN, y);
        doc.text(`Fecha de retiro: ${data.termination_date}`, MARGIN + half, y);

        y = doc.y + 2;
        doc.text(`Dias trabajados: ${data.days_worked}`, MARGIN, y);
        doc.text(
          `Motivo: ${this.formatTerminationReason(data.termination_reason)}`,
          MARGIN + half,
          y,
        );

        y = doc.y + 2;
        doc.text(`Salario base: ${COP.format(data.base_salary)}`, MARGIN, y);

        doc.moveDown(1);
        this.drawHorizontalLine(doc);

        // --- Social Benefits (Prestaciones) ---
        doc.moveDown(0.5);
        this.drawSectionTitle(doc, 'PRESTACIONES SOCIALES');

        const benefits: { label: string; value: number }[] = [
          { label: 'Cesantias', value: data.severance },
          { label: 'Intereses sobre Cesantias', value: data.severance_interest },
          { label: 'Prima de Servicios', value: data.bonus },
          { label: 'Vacaciones', value: data.vacation },
          { label: 'Salario Pendiente', value: data.pending_salary },
        ];

        if (data.indemnification > 0) {
          benefits.push({
            label: 'Indemnizacion',
            value: data.indemnification,
          });
        }

        this.drawConceptTable(doc, benefits);

        doc.moveDown(0.5);
        this.drawHorizontalLine(doc);

        // --- Deductions ---
        doc.moveDown(0.5);
        this.drawSectionTitle(doc, 'DEDUCCIONES');

        const deductions: { label: string; value: number }[] = [
          { label: 'Salud', value: data.health_deduction },
          { label: 'Pension', value: data.pension_deduction },
        ];

        if (data.other_deductions > 0) {
          deductions.push({
            label: 'Otras Deducciones',
            value: data.other_deductions,
          });
        }

        this.drawConceptTable(doc, deductions);

        doc.moveDown(0.5);
        this.drawHorizontalLine(doc);

        // --- Totals ---
        doc.moveDown(0.8);
        this.drawTotals(doc, [
          { label: 'Bruto Liquidacion', value: data.gross_settlement },
          { label: 'Total Deducciones', value: data.total_deductions },
        ]);

        doc.moveDown(0.5);
        this.drawNetPay(doc, data.net_settlement);

        // --- Footer ---
        this.drawFooter(doc);

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  // ─── Private Helpers ────────────────────────────────────────────

  private static drawHeader(
    doc: PDFKit.PDFDocument,
    company_name: string,
    company_nit: string,
    logo_buffer?: Buffer,
  ): void {
    const header_y = doc.y;

    if (logo_buffer) {
      try {
        doc.image(logo_buffer, MARGIN, header_y, {
          width: 60,
          height: 60,
          fit: [60, 60],
        });
      } catch {
        // If logo fails to load, skip it silently
      }
    }

    const text_x = logo_buffer ? MARGIN + 70 : MARGIN;
    doc
      .font('Helvetica-Bold')
      .fontSize(16)
      .text(company_name, text_x, header_y);

    doc
      .font('Helvetica')
      .fontSize(9)
      .text(`NIT: ${company_nit}`, text_x, doc.y + 2);

    // Ensure we are past the logo height
    if (logo_buffer) {
      const min_y = header_y + 65;
      if (doc.y < min_y) {
        doc.y = min_y;
      }
    }
  }

  private static drawSectionTitle(
    doc: PDFKit.PDFDocument,
    title: string,
  ): void {
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .text(title, MARGIN, doc.y);
    doc.moveDown(0.3);
  }

  private static drawConceptTable(
    doc: PDFKit.PDFDocument,
    items: { label: string; value: number }[],
  ): void {
    doc.font('Helvetica').fontSize(9);

    for (const item of items) {
      if (item.value === 0) continue;

      const y = doc.y;
      doc.text(item.label, MARGIN + 10, y);
      doc.text(COP.format(item.value), MARGIN, y, {
        width: CONTENT_WIDTH - 10,
        align: 'right',
      });
      doc.moveDown(0.2);
    }
  }

  private static drawTotals(
    doc: PDFKit.PDFDocument,
    totals: { label: string; value: number }[],
  ): void {
    doc.font('Helvetica-Bold').fontSize(10);

    for (const total of totals) {
      const y = doc.y;
      doc.text(total.label, MARGIN + 10, y);
      doc.text(COP.format(total.value), MARGIN, y, {
        width: CONTENT_WIDTH - 10,
        align: 'right',
      });
      doc.moveDown(0.3);
    }
  }

  private static drawNetPay(
    doc: PDFKit.PDFDocument,
    net_pay: number,
  ): void {
    // Draw a highlighted box for net pay
    const box_y = doc.y;
    const box_height = 30;

    doc
      .save()
      .rect(MARGIN, box_y, CONTENT_WIDTH, box_height)
      .fill('#f0f0f0')
      .restore();

    doc
      .font('Helvetica-Bold')
      .fontSize(12)
      .fillColor('#000000')
      .text('NETO A PAGAR', MARGIN + 10, box_y + 8);

    doc.text(COP.format(net_pay), MARGIN, box_y + 8, {
      width: CONTENT_WIDTH - 10,
      align: 'right',
    });

    doc.y = box_y + box_height;
  }

  private static drawHorizontalLine(doc: PDFKit.PDFDocument): void {
    const y = doc.y;
    doc
      .moveTo(MARGIN, y)
      .lineTo(PAGE_WIDTH - MARGIN, y)
      .strokeColor('#cccccc')
      .lineWidth(0.5)
      .stroke();
    doc.strokeColor('#000000');
  }

  private static drawFooter(doc: PDFKit.PDFDocument): void {
    const now = new Date();
    const date_str = now.toLocaleDateString('es-CO', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    doc.moveDown(2);
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#666666')
      .text(`Generado el ${date_str}`, MARGIN, doc.y, {
        align: 'center',
        width: CONTENT_WIDTH,
      });

    doc.fillColor('#000000');

    // Signature lines
    doc.moveDown(3);
    const sig_y = doc.y;
    const sig_width = 180;
    const left_x = MARGIN + 30;
    const right_x = PAGE_WIDTH - MARGIN - sig_width - 30;

    doc
      .moveTo(left_x, sig_y)
      .lineTo(left_x + sig_width, sig_y)
      .stroke();

    doc
      .moveTo(right_x, sig_y)
      .lineTo(right_x + sig_width, sig_y)
      .stroke();

    doc
      .font('Helvetica')
      .fontSize(8)
      .text('Empleador', left_x, sig_y + 4, {
        width: sig_width,
        align: 'center',
      });

    doc.text('Empleado', right_x, sig_y + 4, {
      width: sig_width,
      align: 'center',
    });
  }

  private static formatTerminationReason(reason: string): string {
    const map: Record<string, string> = {
      voluntary_resignation: 'Renuncia voluntaria',
      just_cause: 'Justa causa',
      without_just_cause: 'Sin justa causa',
      mutual_agreement: 'Mutuo acuerdo',
      contract_expiry: 'Vencimiento de contrato',
      retirement: 'Jubilacion',
      death: 'Fallecimiento',
    };
    return map[reason] || reason;
  }
}
