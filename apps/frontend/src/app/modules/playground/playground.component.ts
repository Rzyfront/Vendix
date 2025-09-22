import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonComponent, CardComponent, DropdownComponent, ToggleComponent } from '../../shared/components';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { ToastService } from '../../shared/components/toast/toast.service';
import { DialogService } from '../../shared/components/dialog/dialog.service';
import { DialogDemoContentComponent } from '../../shared/components/dialog/dialog-demo-content.component';

@Component({
  selector: 'app-playground',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, ButtonComponent, CardComponent, ToggleComponent, DropdownComponent],
  template: `
    <div class="min-h-screen bg-background p-8">
      <div class="max-w-5xl mx-auto space-y-8">
        <h1 class="text-2xl font-bold text-text-primary">Playground UI</h1>

        <app-card class="p-6">
          <h2 class="text-lg font-semibold mb-4">Toasts</h2>
          <div class="flex flex-wrap gap-2">
            <app-button (clicked)="toast.success('Operación exitosa', 'Éxito')">Success</app-button>
            <app-button variant="secondary" (clicked)="toast.info('Información relevante', 'Info')">Info</app-button>
            <app-button variant="outline" (clicked)="toast.warning('Atención requerida', 'Advertencia')">Warning</app-button>
            <app-button variant="danger" (clicked)="toast.error('Algo falló', 'Error')">Error</app-button>
          </div>
        </app-card>

        <app-card class="p-6">
          <h2 class="text-lg font-semibold mb-4">Toggle</h2>
          <div class="flex items-center gap-4">
            <app-toggle [(ngModel)]="enabled" label="Notificaciones"></app-toggle>
            <div class="text-text-secondary text-sm">Estado: {{ enabled ? 'On' : 'Off' }}</div>
          </div>
        </app-card>

        <app-card class="p-6">
          <h2 class="text-lg font-semibold mb-4">Dropdown</h2>
          <app-dropdown>
            <span dropdown-trigger>Opciones</span>
            <button dropdown-item class="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100">Perfil</button>
            <button dropdown-item class="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100">Ajustes</button>
            <button dropdown-item class="block w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50">Salir</button>
          </app-dropdown>
        </app-card>

        <app-card class="p-6">
          <h2 class="text-lg font-semibold mb-4">Dialog (CDK Overlay)</h2>
          <div class="flex flex-wrap gap-2">
            <app-button (clicked)="openDialog()">Abrir diálogo</app-button>
            <app-button variant="secondary" (clicked)="askConfirm()">Confirm</app-button>
            <app-button variant="outline" (clicked)="askPrompt()">Prompt</app-button>
          </div>
        </app-card>
      </div>
    </div>
  `,
})
export class PlaygroundComponent {
  toast = inject(ToastService);
  private dialog = inject(DialogService);
  enabled = true;

  openDialog() {
    const ref = this.dialog.open(DialogDemoContentComponent, { closeOnBackdropClick: true }, {
      title: 'Confirmación',
      message: '¿Deseas continuar con la acción?'
    });
    ref.afterClosed$.subscribe((result) => {
      if (result) {
        this.toast.success('Acción confirmada');
      } else {
        this.toast.info('Acción cancelada');
      }
    });
  }

  async askConfirm() {
    const ok = await this.dialog.confirm({ title: 'Confirmar', message: '¿Deseas eliminar este elemento?' });
    if (ok) this.toast.success('Eliminado'); else this.toast.info('Cancelado');
  }

  async askPrompt() {
    const name = await this.dialog.prompt({ title: 'Tu nombre', placeholder: 'Escribe tu nombre' });
    if (name) this.toast.success(`Hola, ${name}`); else this.toast.info('Sin cambios');
  }
}
