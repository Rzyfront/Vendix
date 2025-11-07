import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '../../../button/button.component';
import { IconComponent } from '../../../icon/icon.component';

@Component({
  selector: 'app-user-setup-step',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, ButtonComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="step-content form-step">
      <div class="step-container">
        <div class="form-section">
          <h3 class="section-title">
            <app-icon name="user" size="20"></app-icon>
            Información personal
          </h3>
          <p class="section-description">
            Completa tu perfil para personalizar tu experiencia
          </p>

          <div class="form-grid">
            <div class="form-field">
              <label class="field-label">Nombre</label>
              <input
                type="text"
                class="field-input"
                [formControl]="formGroup.get('first_name')"
                placeholder="Tu nombre"
              />
            </div>

            <div class="form-field">
              <label class="field-label">Apellido</label>
              <input
                type="text"
                class="field-input"
                [formControl]="formGroup.get('last_name')"
                placeholder="Tu apellido"
              />
            </div>

            <div class="form-field">
              <label class="field-label">Teléfono</label>
              <input
                type="tel"
                class="field-input"
                [formControl]="formGroup.get('phone')"
                placeholder="+1 (555) 123-4567"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class UserSetupStepComponent {
  @Input() formGroup: any;
  @Output() nextStep = new EventEmitter<void>();
  @Output() skipStep = new EventEmitter<void>();
  @Output() previousStep = new EventEmitter<void>();
}