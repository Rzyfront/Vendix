import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { PosTicketService } from '../services/pos-ticket.service';
import {
  TicketData,
  PrinterConfig,
  PrintOptions,
} from '../models/ticket.model';

@Component({
  selector: 'app-pos-ticket-printer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="ticket-printer-container">
      <div class="printer-header">
        <h3>Opciones de Impresión</h3>
        <button class="close-btn" (click)="closePrinter()" type="button">
          <i class="fas fa-times"></i>
        </button>
      </div>

      <div class="printer-content">
        <div class="printer-selection">
          <label for="printer-select">Impresora:</label>
          <select
            id="printer-select"
            class="printer-select"
            [(ngModel)]="selectedPrinter"
            (change)="onPrinterChange()"
          >
            <option
              *ngFor="let printer of printers$ | async"
              [value]="printer.name"
            >
              {{ printer.name }} ({{ printer.type }})
            </option>
          </select>
          <button
            class="test-btn"
            (click)="testPrinter()"
            type="button"
            title="Probar impresora"
          >
            <i class="fas fa-print"></i>
          </button>
        </div>

        <div class="print-options">
          <h4>Opciones de Impresión</h4>

          <div class="option-group">
            <label class="checkbox-label">
              <input
                type="checkbox"
                [(ngModel)]="printOptions.printReceipt"
                (change)="onOptionsChange()"
              />
              Imprimir ticket físico
            </label>
          </div>

          <div class="option-group">
            <label class="checkbox-label">
              <input
                type="checkbox"
                [(ngModel)]="printOptions.openCashDrawer"
                (change)="onOptionsChange()"
              />
              Abrir caja registradora
            </label>
          </div>

          <div class="option-group">
            <label class="checkbox-label">
              <input
                type="checkbox"
                [(ngModel)]="printOptions.emailReceipt"
                (change)="onOptionsChange()"
                [disabled]="!hasCustomerEmail()"
              />
              Enviar por email
              <span *ngIf="ticketData?.customer?.email" class="customer-info">
                ({{ ticketData.customer!.email }})
              </span>
            </label>
          </div>

          <div class="option-group">
            <label class="checkbox-label">
              <input
                type="checkbox"
                [(ngModel)]="printOptions.smsReceipt"
                (change)="onOptionsChange()"
                [disabled]="!hasCustomerPhone()"
              />
              Enviar por SMS
              <span *ngIf="ticketData?.customer?.phone" class="customer-info">
                ({{ ticketData.customer!.phone }})
              </span>
            </label>
          </div>

          <div class="option-group">
            <label for="copies-input">Copias:</label>
            <input
              type="number"
              id="copies-input"
              class="copies-input"
              [(ngModel)]="printOptions.copies"
              (change)="onOptionsChange()"
              min="1"
              max="10"
            />
          </div>
        </div>

        <div class="ticket-preview" *ngIf="showPreview">
          <h4>Vista Previa del Ticket</h4>
          <div class="preview-container" [innerHTML]="ticketPreview"></div>
        </div>
      </div>

      <div class="printer-actions">
        <button
          class="btn btn-secondary"
          (click)="togglePreview()"
          type="button"
        >
          <i class="fas fa-eye"></i>
          {{ showPreview ? 'Ocultar' : 'Mostrar' }} Vista Previa
        </button>
        <button
          class="btn btn-primary"
          (click)="printTicket()"
          [disabled]="printing"
          type="button"
        >
          <i class="fas fa-print"></i>
          {{ printing ? 'Imprimiendo...' : 'Imprimir' }}
        </button>
      </div>
    </div>
  `,
  styles: [
    `
      .ticket-printer-container {
        background: white;
        border-radius: 12px;
        box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
        max-width: 500px;
        max-height: 80vh;
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }

      .printer-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 20px 24px;
        border-bottom: 1px solid #e5e7eb;
      }

      .printer-header h3 {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
        color: #1f2937;
      }

      .close-btn {
        background: none;
        border: none;
        color: #6b7280;
        cursor: pointer;
        padding: 4px;
        border-radius: 4px;
        transition: background-color 0.3s ease;
      }

      .close-btn:hover {
        background-color: #f3f4f6;
      }

      .printer-content {
        flex: 1;
        padding: 20px 24px;
        overflow-y: auto;
      }

      .printer-selection {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 24px;
      }

      .printer-selection label {
        font-weight: 500;
        color: #374151;
        white-space: nowrap;
      }

      .printer-select {
        flex: 1;
        padding: 8px 12px;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        font-size: 14px;
      }

      .printer-select:focus {
        outline: none;
        border-color: #3b82f6;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }

      .test-btn {
        padding: 8px 12px;
        background-color: #f3f4f6;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        color: #374151;
        cursor: pointer;
        transition: all 0.3s ease;
      }

      .test-btn:hover {
        background-color: #e5e7eb;
      }

      .print-options {
        margin-bottom: 24px;
      }

      .print-options h4 {
        margin: 0 0 16px;
        font-size: 16px;
        font-weight: 600;
        color: #1f2937;
      }

      .option-group {
        margin-bottom: 12px;
      }

      .checkbox-label {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        cursor: pointer;
        font-size: 14px;
        color: #374151;
        line-height: 1.5;
      }

      .checkbox-label input[type='checkbox'] {
        margin: 0;
        margin-top: 2px;
      }

      .checkbox-label input[type='checkbox']:disabled + span {
        color: #9ca3af;
      }

      .customer-info {
        font-size: 12px;
        color: #6b7280;
        margin-left: 4px;
      }

      .option-group label:not(.checkbox-label) {
        display: block;
        font-weight: 500;
        color: #374151;
        margin-bottom: 4px;
        font-size: 14px;
      }

      .copies-input {
        width: 80px;
        padding: 6px 10px;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        font-size: 14px;
      }

      .copies-input:focus {
        outline: none;
        border-color: #3b82f6;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      }

      .ticket-preview {
        margin-top: 24px;
      }

      .ticket-preview h4 {
        margin: 0 0 12px;
        font-size: 16px;
        font-weight: 600;
        color: #1f2937;
      }

      .preview-container {
        background: #f9fafb;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 16px;
        max-height: 300px;
        overflow-y: auto;
        font-size: 12px;
        line-height: 1.4;
      }

      .printer-actions {
        display: flex;
        gap: 12px;
        justify-content: flex-end;
        padding: 16px 24px;
        border-top: 1px solid #e5e7eb;
      }

      .btn {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 16px;
        border: none;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.3s ease;
      }

      .btn-primary {
        background-color: #3b82f6;
        color: white;
      }

      .btn-primary:hover:not(:disabled) {
        background-color: #2563eb;
      }

      .btn-primary:disabled {
        background-color: #9ca3af;
        cursor: not-allowed;
      }

      .btn-secondary {
        background-color: #6b7280;
        color: white;
      }

      .btn-secondary:hover {
        background-color: #4b5563;
      }

      @media (max-width: 640px) {
        .printer-selection {
          flex-direction: column;
          align-items: stretch;
        }

        .printer-actions {
          flex-direction: column;
        }

        .btn {
          justify-content: center;
        }
      }
    `,
  ],
})
export class PosTicketPrinterComponent implements OnInit {
  @Input() ticketData!: TicketData;
  @Output() printComplete = new EventEmitter<boolean>();
  @Output() printerClosed = new EventEmitter<void>();

  printers$!: Observable<PrinterConfig[]>;
  selectedPrinter: string = '';
  printOptions: PrintOptions = {
    printReceipt: true,
    openCashDrawer: true,
    emailReceipt: false,
    smsReceipt: false,
    copies: 1,
  };

  showPreview: boolean = false;
  ticketPreview: string = '';
  printing: boolean = false;

  constructor(private ticketService: PosTicketService) {}

  hasCustomerEmail(): boolean {
    return !!this.ticketData?.customer?.email;
  }

  hasCustomerPhone(): boolean {
    return !!this.ticketData?.customer?.phone;
  }

  ngOnInit(): void {
    this.printers$ = this.ticketService.getPrinterConfig();
    this.loadPreview();
  }

  onPrinterChange(): void {
    this.loadPreview();
  }

  onOptionsChange(): void {
    this.loadPreview();
  }

  togglePreview(): void {
    this.showPreview = !this.showPreview;
    if (this.showPreview && !this.ticketPreview) {
      this.loadPreview();
    }
  }

  private loadPreview(): void {
    if (this.ticketData) {
      this.ticketService.previewTicket(this.ticketData).subscribe((preview) => {
        this.ticketPreview = preview;
      });
    }
  }

  testPrinter(): void {
    if (this.selectedPrinter) {
      this.ticketService
        .testPrinter(this.selectedPrinter)
        .subscribe((success) => {
          if (success) {
            console.log('Prueba de impresión exitosa');
          } else {
            console.error('Error en la prueba de impresión');
          }
        });
    }
  }

  printTicket(): void {
    if (!this.ticketData) return;

    this.printing = true;

    const options: PrintOptions = {
      ...this.printOptions,
      printer: this.selectedPrinter,
    };

    this.ticketService.printTicket(this.ticketData, options).subscribe({
      next: (success) => {
        this.printing = false;
        this.printComplete.emit(success);
        if (success) {
          this.closePrinter();
        }
      },
      error: (error) => {
        this.printing = false;
        console.error('Error al imprimir ticket:', error);
        this.printComplete.emit(false);
      },
    });
  }

  closePrinter(): void {
    this.printerClosed.emit();
  }
}
