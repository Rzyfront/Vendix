import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { RolesService } from '../../services/roles.service';
import { ModalComponent, IconComponent } from '../../../../../../shared/components/index';

@Component({
  selector: 'app-edit-role-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ModalComponent, IconComponent],
  templateUrl: './edit-role-modal.component.html',
})
export class EditRoleModalComponent implements OnInit {
  @Input() role: any;
  @Output() close = new EventEmitter<void>();
  @Output() roleUpdated = new EventEmitter<void>();

  roleForm: FormGroup;
  isEditMode = false;
  isLoading = false;

  constructor(private fb: FormBuilder, private rolesService: RolesService) {
    this.roleForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(50)]],
      description: ['', Validators.maxLength(255)],
      is_system_role: [false],
    });
  }

  ngOnInit(): void {
    this.isEditMode = !!this.role;
    
    if (this.role) {
      this.roleForm.patchValue({
        name: this.role.name,
        description: this.role.description || '',
        is_system_role: this.role.is_system_role || false,
      });
      
      // Si es un rol del sistema, deshabilitar algunos campos
      if (this.role.is_system_role) {
        this.roleForm.get('name')?.disable();
        this.roleForm.get('is_system_role')?.disable();
      }
    }
  }

  get title(): string {
    return this.isEditMode ? 'Editar Rol' : 'Crear Nuevo Rol';
  }

  get submitButtonText(): string {
    return this.isEditMode ? 'Actualizar Rol' : 'Crear Rol';
  }

  saveRole(): void {
    if (this.roleForm.valid) {
      this.isLoading = true;
      
      const formData = this.roleForm.value;
      
      if (this.isEditMode) {
        // En modo edición, solo enviar campos modificables
        const updateData = {
          name: formData.name,
          description: formData.description,
        };
        
        this.rolesService.updateRole(this.role.id, updateData).subscribe({
          next: () => {
            this.isLoading = false;
            this.roleUpdated.emit();
            this.close.emit();
          },
          error: (error) => {
            this.isLoading = false;
            console.error('Error updating role:', error);
            // Aquí podrías mostrar un mensaje de error al usuario
          }
        });
      } else {
        // En modo creación
        this.rolesService.createRole(formData).subscribe({
          next: () => {
            this.isLoading = false;
            this.roleUpdated.emit();
            this.close.emit();
          },
          error: (error) => {
            this.isLoading = false;
            console.error('Error creating role:', error);
            // Aquí podrías mostrar un mensaje de error al usuario
          }
        });
      }
    }
  }

  onCancel(): void {
    this.close.emit();
  }
}
