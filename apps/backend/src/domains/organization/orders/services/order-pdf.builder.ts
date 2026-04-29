import PDFDocument from 'pdfkit';

export interface OrderPdfData {
  order_number: string;
  order_date: string;
  customer_name: string;
  customer_email?: string;
  store_name: string;
  currency: string;
  items: OrderPdfItem[];
  subtotal: number;
  tax_amount: number;
  shipping_amount: number;
  discount_amount: number;
  total_amount: number;
  status: string;
  payment_status: string;
}

export interface OrderPdfItem {
  description: string;
  quantity: number;
  unit_price: number;
  total_price: number;
}

const MARGIN = 50;
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const formatCurrency = (amount: number, currency: string): string => {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: currency || 'COP',
    minimumFractionDigits: 0,
  }).format(amount);
};

const formatDate = (dateString: string): string => {
  if (!dateString) return 'N/A';
  return new Date(dateString).toLocaleDateString('es-CO', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

export class OrderPdfBuilder {
  static async generate(data: OrderPdfData): Promise<Buffer> {
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

        let y = MARGIN;

        doc.fontSize(20).font('Helvetica-Bold').text('INVOICE', MARGIN, y);
        y += 30;

        doc.fontSize(10).font('Helvetica');
        doc.text(`Order #: ${data.order_number}`, MARGIN, y);
        y += 15;
        doc.text(`Date: ${formatDate(data.order_date)}`, MARGIN, y);
        y += 15;
        doc.text(`Store: ${data.store_name}`, MARGIN, y);
        y += 15;
        doc.text(`Status: ${data.status}`, MARGIN, y);
        y += 15;
        doc.text(`Payment: ${data.payment_status}`, MARGIN, y);
        y += 30;

        doc
          .moveTo(MARGIN, y)
          .lineTo(PAGE_WIDTH - MARGIN, y)
          .stroke();
        y += 20;

        doc.font('Helvetica-Bold').fontSize(11);
        doc.text('Customer', MARGIN, y);
        y += 15;
        doc.font('Helvetica').fontSize(10);
        doc.text(data.customer_name || 'Guest', MARGIN, y);
        y += 12;
        if (data.customer_email) {
          doc.text(data.customer_email, MARGIN, y);
          y += 12;
        }
        y += 20;

        doc
          .moveTo(MARGIN, y)
          .lineTo(PAGE_WIDTH - MARGIN, y)
          .stroke();
        y += 15;

        const col1X = MARGIN;
        const col2X = MARGIN + 250;
        const col3X = MARGIN + 320;
        const col4X = MARGIN + 380;
        const col5X = MARGIN + 450;

        doc.font('Helvetica-Bold').fontSize(10);
        doc.text('Item', col1X, y);
        doc.text('Qty', col4X, y, { width: 50, align: 'right' });
        doc.text('Price', col5X, y, { width: 70, align: 'right' });
        y += 20;

        doc.font('Helvetica').fontSize(9);

        for (const item of data.items) {
          if (y > PAGE_HEIGHT - 150) {
            doc.addPage();
            y = MARGIN;
          }

          const itemName =
            item.description.length > 40
              ? item.description.substring(0, 40) + '...'
              : item.description;

          doc.text(itemName, col1X, y, { width: 280 });
          doc.text(item.quantity.toString(), col4X, y, {
            width: 50,
            align: 'right',
          });
          doc.text(formatCurrency(item.unit_price, data.currency), col5X, y, {
            width: 70,
            align: 'right',
          });
          y += 18;
        }

        y += 10;
        doc
          .moveTo(MARGIN, y)
          .lineTo(PAGE_WIDTH - MARGIN, y)
          .stroke();
        y += 20;

        const rightAlignX = PAGE_WIDTH - MARGIN - 150;
        const valueX = PAGE_WIDTH - MARGIN - 70;

        doc.fontSize(10).font('Helvetica');
        doc.text('Subtotal:', rightAlignX, y, { width: 80, align: 'right' });
        doc.text(formatCurrency(data.subtotal, data.currency), valueX, y, {
          width: 70,
          align: 'right',
        });
        y += 15;

        if (data.discount_amount > 0) {
          doc.text('Discount:', rightAlignX, y, { width: 80, align: 'right' });
          doc.text(
            `-${formatCurrency(data.discount_amount, data.currency)}`,
            valueX,
            y,
            { width: 70, align: 'right' },
          );
          y += 15;
        }

        if (data.tax_amount > 0) {
          doc.text('Tax:', rightAlignX, y, { width: 80, align: 'right' });
          doc.text(formatCurrency(data.tax_amount, data.currency), valueX, y, {
            width: 70,
            align: 'right',
          });
          y += 15;
        }

        if (data.shipping_amount > 0) {
          doc.text('Shipping:', rightAlignX, y, { width: 80, align: 'right' });
          doc.text(
            formatCurrency(data.shipping_amount, data.currency),
            valueX,
            y,
            { width: 70, align: 'right' },
          );
          y += 15;
        }

        y += 5;
        doc
          .moveTo(rightAlignX, y)
          .lineTo(PAGE_WIDTH - MARGIN, y)
          .stroke();
        y += 10;

        doc.fontSize(12).font('Helvetica-Bold');
        doc.text('TOTAL:', rightAlignX, y, { width: 80, align: 'right' });
        doc.text(formatCurrency(data.total_amount, data.currency), valueX, y, {
          width: 70,
          align: 'right',
        });

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }
}
