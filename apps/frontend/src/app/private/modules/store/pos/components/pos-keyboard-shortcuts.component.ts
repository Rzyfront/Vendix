import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  PosKeyboardService,
  ShortcutGroup,
} from '../services/pos-keyboard.service';
import { Subject } from 'rxjs';

@Component({
  selector: 'app-pos-keyboard-shortcuts',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="keyboard-shortcuts-container">
      <button
        class="shortcuts-toggle-btn"
        (click)="toggleShortcutsHelp()"
        [class.active]="showHelp"
        type="button"
        title="Mostrar atajos de teclado (F1)"
      >
        <i class="fas fa-keyboard"></i>
        <span>Atajos</span>
      </button>

      <div
        class="shortcuts-help-modal"
        *ngIf="showHelp"
        (click)="onBackdropClick($event)"
      >
        <div class="shortcuts-help-content" (click)="$event.stopPropagation()">
          <div class="help-header">
            <h3>Atajos de Teclado</h3>
            <button
              class="close-btn"
              (click)="toggleShortcutsHelp()"
              type="button"
            >
              <i class="fas fa-times"></i>
            </button>
          </div>

          <div class="help-body">
            <div class="shortcut-section" *ngFor="let group of shortcutGroups">
              <h4>{{ group.name }}</h4>
              <div class="shortcuts-list">
                <div
                  class="shortcut-item"
                  *ngFor="let shortcut of group.shortcuts"
                >
                  <div class="shortcut-keys">
                    <span class="key" *ngIf="shortcut.ctrlKey">Ctrl</span>
                    <span class="key" *ngIf="shortcut.altKey">Alt</span>
                    <span class="key" *ngIf="shortcut.shiftKey">Shift</span>
                    <span class="key main-key">{{
                      shortcut.key.toUpperCase()
                    }}</span>
                  </div>
                  <div class="shortcut-description">
                    {{ shortcut.description }}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="help-footer">
            <button
              class="btn btn-primary"
              (click)="toggleShortcutsHelp()"
              type="button"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .keyboard-shortcuts-container {
        position: relative;
      }

      .shortcuts-toggle-btn {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 16px;
        background-color: #f3f4f6;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        color: #374151;
        cursor: pointer;
        font-size: 14px;
        transition: all 0.3s ease;
      }

      .shortcuts-toggle-btn:hover,
      .shortcuts-toggle-btn.active {
        background-color: #3b82f6;
        border-color: #3b82f6;
        color: white;
      }

      .shortcuts-help-modal {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        padding: 20px;
      }

      .shortcuts-help-content {
        background: white;
        border-radius: 12px;
        max-width: 600px;
        width: 100%;
        max-height: 80vh;
        overflow: hidden;
        box-shadow:
          0 20px 25px -5px rgba(0, 0, 0, 0.1),
          0 10px 10px -5px rgba(0, 0, 0, 0.04);
      }

      .help-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 24px 24px 16px;
        border-bottom: 1px solid #e5e7eb;
      }

      .help-header h3 {
        margin: 0;
        font-size: 20px;
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

      .help-body {
        padding: 16px 24px;
        max-height: 60vh;
        overflow-y: auto;
      }

      .shortcut-section {
        margin-bottom: 24px;
      }

      .shortcut-section:last-child {
        margin-bottom: 0;
      }

      .shortcut-section h4 {
        margin: 0 0 12px;
        font-size: 16px;
        font-weight: 600;
        color: #374151;
        padding-bottom: 8px;
        border-bottom: 1px solid #f3f4f6;
      }

      .shortcuts-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .shortcut-item {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 8px 0;
      }

      .shortcut-keys {
        display: flex;
        align-items: center;
        gap: 4px;
        min-width: 120px;
      }

      .key {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 4px 8px;
        background-color: #f3f4f6;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 500;
        color: #374151;
        font-family: 'Courier New', monospace;
        min-width: 24px;
      }

      .key.main-key {
        background-color: #3b82f6;
        border-color: #3b82f6;
        color: white;
        font-weight: 600;
      }

      .shortcut-description {
        flex: 1;
        font-size: 14px;
        color: #6b7280;
      }

      .help-footer {
        padding: 16px 24px 24px;
        border-top: 1px solid #e5e7eb;
        display: flex;
        justify-content: flex-end;
      }

      .btn {
        padding: 8px 16px;
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

      .btn-primary:hover {
        background-color: #2563eb;
      }

      @media (max-width: 640px) {
        .shortcuts-help-modal {
          padding: 10px;
        }

        .shortcuts-help-content {
          max-height: 90vh;
        }

        .shortcut-item {
          flex-direction: column;
          align-items: flex-start;
          gap: 8px;
        }

        .shortcut-keys {
          min-width: auto;
        }
      }
    `,
  ],
})
export class PosKeyboardShortcutsComponent implements OnInit, OnDestroy {
  @Input() customShortcuts: ShortcutGroup[] = [];
  @Output() shortcutTriggered = new EventEmitter<{
    key: string;
    action: string;
  }>();

  showHelp: boolean = false;
  shortcutGroups: ShortcutGroup[] = [];
  private destroy$ = new Subject<void>();

  constructor(private keyboardService: PosKeyboardService) {}

  ngOnInit(): void {
    this.initializeDefaultShortcuts();
    this.setupKeyboardService();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private initializeDefaultShortcuts(): void {
    const defaultGroups: ShortcutGroup[] = [
      {
        name: 'Navegación',
        shortcuts: [
          {
            key: 'F1',
            action: () => this.toggleShortcutsHelp(),
            description: 'Mostrar/Ocultar ayuda de atajos',
          },
          {
            key: 'Escape',
            action: () => this.handleEscape(),
            description: 'Cerrar diálogos o cancelar acciones',
          },
        ],
      },
      {
        name: 'Búsqueda',
        shortcuts: [
          {
            key: '/',
            action: () => this.focusSearch(),
            description: 'Enfocar búsqueda de productos',
          },
          {
            key: 'F2',
            action: () => this.toggleBarcodeScanner(),
            description: 'Abrir escáner de códigos de barras',
          },
        ],
      },
      {
        name: 'Carrito',
        shortcuts: [
          {
            key: 'F3',
            action: () => this.clearCart(),
            description: 'Vaciar carrito',
          },
          {
            key: 'F4',
            action: () => this.viewCart(),
            description: 'Ver detalles del carrito',
          },
          {
            key: 'Delete',
            ctrlKey: true,
            action: () => this.removeSelectedCartItem(),
            description: 'Eliminar item seleccionado del carrito',
          },
        ],
      },
      {
        name: 'Clientes',
        shortcuts: [
          {
            key: 'F5',
            action: () => this.searchCustomers(),
            description: 'Buscar cliente',
          },
          {
            key: 'F6',
            action: () => this.addNewCustomer(),
            description: 'Agregar nuevo cliente',
          },
        ],
      },
      {
        name: 'Pago',
        shortcuts: [
          {
            key: 'F9',
            action: () => this.initiatePayment(),
            description: 'Iniciar proceso de pago',
          },
          {
            key: 'F10',
            action: () => this.quickCashPayment(),
            description: 'Pago rápido en efectivo',
          },
          {
            key: 'F11',
            action: () => this.quickCardPayment(),
            description: 'Pago rápido con tarjeta',
          },
        ],
      },
      {
        name: 'Operaciones',
        shortcuts: [
          {
            key: 'F12',
            action: () => this.completeSale(),
            description: 'Completar venta',
          },
          {
            key: 's',
            ctrlKey: true,
            action: () => this.holdSale(),
            description: 'Poner venta en espera',
          },
          {
            key: 'r',
            ctrlKey: true,
            action: () => this.resumeSale(),
            description: 'Reanudar venta en espera',
          },
        ],
      },
    ];

    this.shortcutGroups = [...defaultGroups, ...this.customShortcuts];
  }

  private setupKeyboardService(): void {
    this.shortcutGroups.forEach((group) => {
      this.keyboardService.registerShortcutGroup(group);
    });

    this.keyboardService.enableShortcuts();
  }

  toggleShortcutsHelp(): void {
    this.showHelp = !this.showHelp;
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.showHelp = false;
    }
  }

  private handleEscape(): void {
    if (this.showHelp) {
      this.showHelp = false;
    }
    this.shortcutTriggered.emit({ key: 'Escape', action: 'handleEscape' });
  }

  private focusSearch(): void {
    this.shortcutTriggered.emit({ key: '/', action: 'focusSearch' });
  }

  private toggleBarcodeScanner(): void {
    this.shortcutTriggered.emit({ key: 'F2', action: 'toggleBarcodeScanner' });
  }

  private clearCart(): void {
    this.shortcutTriggered.emit({ key: 'F3', action: 'clearCart' });
  }

  private viewCart(): void {
    this.shortcutTriggered.emit({ key: 'F4', action: 'viewCart' });
  }

  private removeSelectedCartItem(): void {
    this.shortcutTriggered.emit({
      key: 'Ctrl+Delete',
      action: 'removeSelectedCartItem',
    });
  }

  private searchCustomers(): void {
    this.shortcutTriggered.emit({ key: 'F5', action: 'searchCustomers' });
  }

  private addNewCustomer(): void {
    this.shortcutTriggered.emit({ key: 'F6', action: 'addNewCustomer' });
  }

  private initiatePayment(): void {
    this.shortcutTriggered.emit({ key: 'F9', action: 'initiatePayment' });
  }

  private quickCashPayment(): void {
    this.shortcutTriggered.emit({ key: 'F10', action: 'quickCashPayment' });
  }

  private quickCardPayment(): void {
    this.shortcutTriggered.emit({ key: 'F11', action: 'quickCardPayment' });
  }

  private completeSale(): void {
    this.shortcutTriggered.emit({ key: 'F12', action: 'completeSale' });
  }

  private holdSale(): void {
    this.shortcutTriggered.emit({ key: 'Ctrl+S', action: 'holdSale' });
  }

  private resumeSale(): void {
    this.shortcutTriggered.emit({ key: 'Ctrl+R', action: 'resumeSale' });
  }
}
