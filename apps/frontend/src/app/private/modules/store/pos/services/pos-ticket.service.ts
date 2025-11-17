import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { delay, map } from 'rxjs/operators';
import {
  TicketData,
  PrinterConfig,
  PrintOptions,
} from '../models/ticket.model';

@Injectable({
  providedIn: 'root',
})
export class PosTicketService {
  private defaultPrinterConfig: PrinterConfig = {
    name: 'Default Thermal Printer',
    type: 'thermal',
    paperWidth: 80,
    copies: 1,
    autoPrint: true,
    printHeader: true,
    printFooter: true,
    printBarcode: true,
  };

  private storeConfig = {
    name: 'Vendix Store',
    address: '123 Main St, City, State 12345',
    phone: '+1 (555) 123-4567',
    email: 'info@vendix.com',
    taxId: 'TAX-123456789',
  };

  printTicket(
    ticketData: TicketData,
    options: PrintOptions = {},
  ): Observable<boolean> {
    const printOptions = { ...this.getDefaultPrintOptions(), ...options };

    return of(ticketData).pipe(
      delay(1500),
      map(() => {
        if (printOptions.printReceipt) {
          this.generateTicketHTML(ticketData);
          console.log('Ticket impreso:', ticketData.id);
        }

        if (printOptions.openCashDrawer) {
          this.openCashDrawer();
        }

        if (printOptions.emailReceipt && ticketData.customer?.email) {
          this.emailTicket(ticketData, ticketData.customer.email);
        }

        if (printOptions.smsReceipt && ticketData.customer?.phone) {
          this.smsTicket(ticketData, ticketData.customer.phone);
        }

        return true;
      }),
    );
  }

  generateTicketHTML(ticketData: TicketData): string {
    const store = ticketData.store || this.storeConfig;
    const date = new Date(ticketData.date).toLocaleString();

    let html = `
      <div class="ticket" style="font-family: monospace; max-width: ${this.defaultPrinterConfig.paperWidth}mm; margin: 0 auto; padding: 10px;">
    `;

    if (this.defaultPrinterConfig.printHeader) {
      html += `
        <div style="text-align: center; margin-bottom: 20px;">
          <h2 style="margin: 0; font-size: 18px; font-weight: bold;">${store.name}</h2>
          <p style="margin: 2px 0; font-size: 12px;">${store.address}</p>
          <p style="margin: 2px 0; font-size: 12px;">Tel: ${store.phone}</p>
          <p style="margin: 2px 0; font-size: 12px;">Email: ${store.email}</p>
          <p style="margin: 2px 0; font-size: 12px;">NIT: ${store.taxId}</p>
        </div>
        <hr style="border: 1px dashed #000; margin: 10px 0;">
      `;
    }

    html += `
      <div style="margin-bottom: 15px;">
        <p style="margin: 2px 0; font-size: 12px;"><strong>Ticket:</strong> #${ticketData.id}</p>
        <p style="margin: 2px 0; font-size: 12px;"><strong>Fecha:</strong> ${date}</p>
        <p style="margin: 2px 0; font-size: 12px;"><strong>Cajero:</strong> ${ticketData.cashier || 'N/A'}</p>
        ${ticketData.transactionId ? `<p style="margin: 2px 0; font-size: 12px;"><strong>Transacción:</strong> ${ticketData.transactionId}</p>` : ''}
      </div>
      <hr style="border: 1px dashed #000; margin: 10px 0;">
    `;

    if (ticketData.customer) {
      html += `
        <div style="margin-bottom: 15px;">
          <p style="margin: 2px 0; font-size: 12px;"><strong>Cliente:</strong> ${ticketData.customer.name}</p>
          ${ticketData.customer.email ? `<p style="margin: 2px 0; font-size: 12px;">Email: ${ticketData.customer.email}</p>` : ''}
          ${ticketData.customer.phone ? `<p style="margin: 2px 0; font-size: 12px;">Tel: ${ticketData.customer.phone}</p>` : ''}
          ${ticketData.customer.taxId ? `<p style="margin: 2px 0; font-size: 12px;">NIT: ${ticketData.customer.taxId}</p>` : ''}
        </div>
        <hr style="border: 1px dashed #000; margin: 10px 0;">
      `;
    }

    html += `
      <div style="margin-bottom: 15px;">
        <table style="width: 100%; font-size: 11px; border-collapse: collapse;">
          <thead>
            <tr>
              <th style="text-align: left; padding: 2px;">Producto</th>
              <th style="text-align: center; padding: 2px;">Cant</th>
              <th style="text-align: right; padding: 2px;">Precio</th>
              <th style="text-align: right; padding: 2px;">Total</th>
            </tr>
          </thead>
          <tbody>
    `;

    ticketData.items.forEach((item) => {
      html += `
        <tr>
          <td style="padding: 2px; vertical-align: top;">${item.name}</td>
          <td style="text-align: center; padding: 2px;">${item.quantity}</td>
          <td style="text-align: right; padding: 2px;">$${item.unitPrice.toFixed(2)}</td>
          <td style="text-align: right; padding: 2px;">$${item.totalPrice.toFixed(2)}</td>
        </tr>
      `;
    });

    html += `
          </tbody>
        </table>
      </div>
      <hr style="border: 1px dashed #000; margin: 10px 0;">
    `;

    html += `
      <div style="margin-bottom: 15px;">
        <table style="width: 100%; font-size: 12px; border-collapse: collapse;">
          <tr>
            <td style="text-align: left; padding: 2px;">Subtotal:</td>
            <td style="text-align: right; padding: 2px;">$${ticketData.subtotal.toFixed(2)}</td>
          </tr>
          ${
            ticketData.discount > 0
              ? `
          <tr>
            <td style="text-align: left; padding: 2px;">Descuento:</td>
            <td style="text-align: right; padding: 2px;">-$${ticketData.discount.toFixed(2)}</td>
          </tr>
          `
              : ''
          }
          <tr>
            <td style="text-align: left; padding: 2px;">Impuesto:</td>
            <td style="text-align: right; padding: 2px;">$${ticketData.tax.toFixed(2)}</td>
          </tr>
          <tr style="font-weight: bold; border-top: 1px solid #000;">
            <td style="text-align: left; padding: 2px;">TOTAL:</td>
            <td style="text-align: right; padding: 2px;">$${ticketData.total.toFixed(2)}</td>
          </tr>
        </table>
      </div>
    `;

    html += `
      <div style="margin-bottom: 15px;">
        <p style="margin: 2px 0; font-size: 12px;"><strong>Método de pago:</strong> ${ticketData.paymentMethod}</p>
        ${
          ticketData.cashReceived
            ? `
        <p style="margin: 2px 0; font-size: 12px;"><strong>Efectivo recibido:</strong> $${ticketData.cashReceived.toFixed(2)}</p>
        <p style="margin: 2px 0; font-size: 12px;"><strong>Cambio:</strong> $${ticketData.change!.toFixed(2)}</p>
        `
            : ''
        }
      </div>
    `;

    if (this.defaultPrinterConfig.printFooter) {
      html += `
        <hr style="border: 1px dashed #000; margin: 10px 0;">
        <div style="text-align: center; margin-top: 20px;">
          <p style="margin: 5px 0; font-size: 11px;">¡Gracias por su compra!</p>
          <p style="margin: 5px 0; font-size: 10px;">Vuelva pronto</p>
          <p style="margin: 10px 0 0 0; font-size: 9px; color: #666;">
            ${new Date().toLocaleString()}
          </p>
        </div>
      `;
    }

    html += `</div>`;
    return html;
  }

  generateTicketPDF(ticketData: TicketData): Observable<Blob> {
    return of(ticketData).pipe(
      delay(1000),
      map(() => {
        const html = this.generateTicketHTML(ticketData);
        return new Blob([html], { type: 'text/html' });
      }),
    );
  }

  private openCashDrawer(): void {
    console.log('Abriendo caja registradora...');
  }

  private emailTicket(ticketData: TicketData, email: string): void {
    console.log(`Enviando ticket ${ticketData.id} por email a ${email}`);
  }

  private smsTicket(ticketData: TicketData, phone: string): void {
    console.log(`Enviando ticket ${ticketData.id} por SMS a ${phone}`);
  }

  private getDefaultPrintOptions(): PrintOptions {
    return {
      printer: this.defaultPrinterConfig.name,
      copies: this.defaultPrinterConfig.copies,
      openCashDrawer: true,
      printReceipt: true,
      emailReceipt: false,
      smsReceipt: false,
    };
  }

  getPrinterConfig(): Observable<PrinterConfig[]> {
    const printers: PrinterConfig[] = [
      this.defaultPrinterConfig,
      {
        name: 'Standard A4 Printer',
        type: 'standard',
        paperWidth: 210,
        copies: 1,
        autoPrint: false,
        printHeader: true,
        printFooter: true,
        printBarcode: false,
      },
      {
        name: 'PDF Generator',
        type: 'pdf',
        paperWidth: 80,
        copies: 1,
        autoPrint: false,
        printHeader: true,
        printFooter: true,
        printBarcode: true,
      },
    ];

    return of(printers).pipe(delay(500));
  }

  updatePrinterConfig(config: PrinterConfig): Observable<PrinterConfig> {
    return of(config).pipe(
      delay(300),
      map(() => config),
    );
  }

  testPrinter(printerName: string): Observable<boolean> {
    return of(printerName).pipe(
      delay(2000),
      map(() => {
        console.log(`Imprimiendo página de prueba en ${printerName}`);
        return true;
      }),
    );
  }

  previewTicket(ticketData: TicketData): Observable<string> {
    return of(this.generateTicketHTML(ticketData)).pipe(delay(500));
  }

  saveTicketTemplate(template: string): Observable<boolean> {
    return of(template).pipe(
      delay(300),
      map(() => {
        console.log('Plantilla de ticket guardada');
        return true;
      }),
    );
  }

  loadTicketTemplate(): Observable<string> {
    return of('').pipe(
      delay(300),
      map(() => {
        return this.getDefaultTicketTemplate();
      }),
    );
  }

  private getDefaultTicketTemplate(): string {
    return `
<div class="ticket">
  <header>
    <h2>{{store.name}}</h2>
    <p>{{store.address}}</p>
  </header>
  <main>
    <h3>Ticket #{{ticket.id}}</h3>
    <p>Fecha: {{ticket.date}}</p>
    <table>
      <tr ng-repeat="item in ticket.items">
        <td>{{item.name}}</td>
        <td>{{item.quantity}}</td>
        <td>{{item.unitPrice}}</td>
        <td>{{item.totalPrice}}</td>
      </tr>
    </table>
    <p>Total: {{ticket.total}}</p>
  </main>
  <footer>
    <p>¡Gracias por su compra!</p>
  </footer>
</div>
    `.trim();
  }
}
