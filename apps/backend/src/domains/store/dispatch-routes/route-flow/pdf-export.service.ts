import PDFDocument from 'pdfkit';

interface RouteForPdf {
  id: number;
  route_number: string;
  route_code?: string | null;
  status: string;
  planned_date: Date;
  dispatch_started_at?: Date | null;
  closed_at?: Date | null;
  total_to_collect: any;
  total_collected: any;
  total_prepaid: any;
  total_changes: any;
  total_withholdings: any;
  total_credit: any;
  declared_cash?: any;
  cash_variance?: any;
  currency?: string | null;
  notes?: string | null;
  vehicle?: { plate: string; type?: string; brand?: string | null; model_name?: string | null } | null;
  driver_user?: { first_name?: string | null; last_name?: string | null; document_number?: string | null } | null;
  external_driver_name?: string | null;
  external_driver_id_number?: string | null;
  origin_location?: { name: string; code?: string | null } | null;
  stops: Array<{
    id: number;
    stop_sequence: number;
    status: string;
    result?: string | null;
    is_prepaid: boolean;
    is_extra_route: boolean;
    collected_amount: any;
    anticipo_amount: any;
    change_amount: any;
    withholding_amount: any;
    credit_amount: any;
    payment_method?: string | null;
    settled_at?: Date | null;
    dispatch_note?: {
      dispatch_number: string;
      customer_name?: string | null;
      grand_total: any;
    } | null;
  }>;
}

const COP = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  minimumFractionDigits: 0,
});

const fmtDate = (d: Date | null | undefined) => {
  if (!d) return '—';
  const date = new Date(d);
  return date.toLocaleString('es-CO', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const MARGIN = 40;
const PAGE_WIDTH = 612; // Letter
const PAGE_HEIGHT = 792;

export class PdfExportService {
  async generate(route: RouteForPdf): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'LETTER',
          margin: MARGIN,
          bufferPages: true,
        });
        const chunks: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        this.drawHeader(doc, route);
        this.drawTitle(doc, route);
        this.drawRouteInfo(doc, route);
        this.drawDriverInfo(doc, route);
        this.drawStopsTable(doc, route);
        this.drawTotals(doc, route);
        this.drawSignatures(doc);
        this.drawFooter(doc);

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  private drawHeader(doc: PDFKit.PDFDocument, route: RouteForPdf) {
    doc
      .font('Helvetica-Bold')
      .fontSize(18)
      .text('PLANILLA DE DESPACHO', MARGIN, MARGIN, { align: 'center' });
    doc.fontSize(10).font('Helvetica').text(`(Ruta de Recaudo)`, { align: 'center' });
    doc.moveDown(0.5);
    this.hr(doc);
  }

  private drawTitle(doc: PDFKit.PDFDocument, route: RouteForPdf) {
    doc.moveDown(0.4);
    doc
      .font('Helvetica-Bold')
      .fontSize(14)
      .text(`Planilla N° ${route.route_number}`, MARGIN, doc.y);
    if (route.route_code) {
      doc.fontSize(10).font('Helvetica').text(`Ruta: ${route.route_code}`);
    }
    doc.fontSize(10).text(`Estado: ${route.status.toUpperCase()}`);
    doc.text(`Fecha planeada: ${fmtDate(route.planned_date)}`);
    if (route.dispatch_started_at) {
      doc.text(`Despachada: ${fmtDate(route.dispatch_started_at)}`);
    }
    if (route.closed_at) {
      doc.text(`Cerrada: ${fmtDate(route.closed_at)}`);
    }
    doc.moveDown(0.3);
    this.hr(doc);
  }

  private drawRouteInfo(doc: PDFKit.PDFDocument, route: RouteForPdf) {
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').fontSize(11).text('Información de la Ruta');
    doc.font('Helvetica').fontSize(10);
    if (route.vehicle) {
      doc.text(
        `Vehículo: ${route.vehicle.plate} (${route.vehicle.type || 'N/A'}) ${route.vehicle.brand || ''} ${route.vehicle.model_name || ''}`.trim(),
      );
    } else {
      doc.text('Vehículo: —');
    }
    if (route.origin_location) {
      doc.text(`Origen: ${route.origin_location.name} (${route.origin_location.code || '—'})`);
    }
  }

  private drawDriverInfo(doc: PDFKit.PDFDocument, route: RouteForPdf) {
    doc.moveDown(0.2);
    doc.font('Helvetica-Bold').fontSize(11).text('Conductor / Personal');
    doc.font('Helvetica').fontSize(10);
    if (route.driver_user) {
      doc.text(
        `Conductor: ${route.driver_user.first_name || ''} ${route.driver_user.last_name || ''}`.trim() +
          (route.driver_user.document_number ? ` (CC ${route.driver_user.document_number})` : ''),
      );
    } else if (route.external_driver_name) {
      doc.text(
        `Conductor externo: ${route.external_driver_name}` +
          (route.external_driver_id_number ? ` (CC ${route.external_driver_id_number})` : ''),
      );
    } else {
      doc.text('Conductor: —');
    }
    const assistants = (route as any).assistants as Array<any> | undefined;
    if (assistants && assistants.length > 0) {
      const lines = assistants.map((a) => {
        if (a.user_id) {
          return `• Auxiliar #${a.user_id}${a.role ? ` (${a.role})` : ''}`;
        }
        return `• Auxiliar externo: ${a.external_name || '—'}${a.external_id_number ? ` (CC ${a.external_id_number})` : ''}${a.role ? ` - ${a.role}` : ''}`;
      });
      lines.forEach((l) => doc.text(l));
    }
    doc.moveDown(0.3);
    this.hr(doc);
  }

  private drawStopsTable(doc: PDFKit.PDFDocument, route: RouteForPdf) {
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').fontSize(11).text('Paradas');
    doc.moveDown(0.2);

    const col_widths = [22, 70, 90, 60, 50, 50, 50, 50]; // 8 cols
    const headers = ['#', 'Remisión', 'Cliente', 'Neto', 'Anticipo', 'Recaudado', 'Cambio', 'Retención'];

    const startX = MARGIN;
    let y = doc.y;

    // Header row
    doc.font('Helvetica-Bold').fontSize(9);
    let x = startX;
    headers.forEach((h, i) => {
      doc.text(h, x, y, { width: col_widths[i], align: i === 0 ? 'center' : 'right' });
      x += col_widths[i];
    });
    y += 14;
    this.hr(doc, y - 4, MARGIN, PAGE_WIDTH - MARGIN * 2);
    y += 2;

    // Rows
    doc.font('Helvetica').fontSize(9);
    for (const stop of route.stops) {
      if (y > PAGE_HEIGHT - 200) {
        doc.addPage();
        y = MARGIN;
      }
      const dn = stop.dispatch_note;
      const is_released = stop.result === 'released' || stop.status === 'released';
      const is_rejected = stop.result === 'rejected' || stop.status === 'rejected';
      const customer = is_released ? '(Liberada)' : is_rejected ? '(Rechazada)' : dn?.customer_name || '—';
      const row = [
        String(stop.stop_sequence),
        dn?.dispatch_number || '—',
        customer,
        dn ? COP.format(Number(dn.grand_total)) : '—',
        COP.format(Number(stop.anticipo_amount || 0)),
        stop.is_prepaid ? 'PREPAGADO' : COP.format(Number(stop.collected_amount || 0)),
        COP.format(Number(stop.change_amount || 0)),
        COP.format(Number(stop.withholding_amount || 0)),
      ];
      x = startX;
      row.forEach((val, i) => {
        doc.text(val, x, y, { width: col_widths[i], align: i === 0 ? 'center' : 'right' });
        x += col_widths[i];
      });
      y += 14;
    }

    doc.y = y + 4;
    this.hr(doc);
  }

  private drawTotals(doc: PDFKit.PDFDocument, route: RouteForPdf) {
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fontSize(11).text('Resumen de Recaudo', MARGIN, doc.y, { align: 'right' });
    doc.font('Helvetica').fontSize(10);
    const label_x = PAGE_WIDTH - MARGIN - 220;
    const value_x = PAGE_WIDTH - MARGIN - 60;
    const line_h = 14;
    let y = doc.y;

    const lines: Array<[string, string]> = [
      ['Total a recaudar:', COP.format(Number(route.total_to_collect || 0))],
      ['Total prepagado:', COP.format(Number(route.total_prepaid || 0))],
      ['Total recaudado:', COP.format(Number(route.total_collected || 0))],
      ['Total cambios/devoluciones:', COP.format(Number(route.total_changes || 0))],
      ['Total retenciones:', COP.format(Number(route.total_withholdings || 0))],
      ['Total a crédito:', COP.format(Number(route.total_credit || 0))],
    ];
    if (route.declared_cash != null) {
      lines.push(['Efectivo declarado:', COP.format(Number(route.declared_cash))]);
    }
    if (route.cash_variance != null) {
      const variance = Number(route.cash_variance);
      lines.push([
        'Diferencia de caja:',
        COP.format(variance) + (variance === 0 ? ' (CUADRA)' : variance > 0 ? ' (SOBRA)' : ' (FALTA)'),
      ]);
    }

    for (const [label, value] of lines) {
      doc.text(label, label_x, y, { width: 150, align: 'right' });
      doc.text(value, value_x, y, { width: 80, align: 'right' });
      y += line_h;
    }
    doc.y = y + 10;
    this.hr(doc);
  }

  private drawSignatures(doc: PDFKit.PDFDocument) {
    doc.moveDown(1.2);
    const y = doc.y;
    const col1_x = MARGIN;
    const col2_x = PAGE_WIDTH / 2 + 10;
    const col_width = PAGE_WIDTH / 2 - MARGIN - 20;

    // Signature lines
    doc.moveTo(col1_x, y + 40).lineTo(col1_x + col_width, y + 40).stroke();
    doc.moveTo(col2_x, y + 40).lineTo(col2_x + col_width, y + 40).stroke();

    doc.font('Helvetica').fontSize(9);
    doc.text('Conductor / Responsable de la ruta', col1_x, y + 42, {
      width: col_width,
      align: 'center',
    });
    doc.text('Quien recibe / Cierra la planilla', col2_x, y + 42, {
      width: col_width,
      align: 'center',
    });
  }

  private drawFooter(doc: PDFKit.PDFDocument) {
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.font('Helvetica').fontSize(8).fillColor('#666');
      doc.text(
        `Generado el ${new Date().toLocaleString('es-CO')} — Página ${i + 1} de ${range.count}`,
        MARGIN,
        PAGE_HEIGHT - 30,
        { width: PAGE_WIDTH - MARGIN * 2, align: 'center' },
      );
      doc.fillColor('black');
    }
  }

  private hr(doc: PDFKit.PDFDocument, y?: number, x1?: number, x2?: number) {
    const yPos = y ?? doc.y;
    const a = x1 ?? MARGIN;
    const b = x2 ?? PAGE_WIDTH - MARGIN;
    doc.moveTo(a, yPos).lineTo(b, yPos).strokeColor('#999').stroke();
    doc.strokeColor('black');
  }
}
