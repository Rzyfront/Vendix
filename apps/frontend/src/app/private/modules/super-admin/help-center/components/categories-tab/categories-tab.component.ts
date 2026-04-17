import {Component, OnInit, inject, signal, DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { HelpCenterAdminService } from '../../services/help-center-admin.service';
import { HelpCategory } from '../../../../../modules/store/help/models/help-article.model';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import { TextareaComponent } from '../../../../../../shared/components/textarea/textarea.component';
import { ToggleComponent } from '../../../../../../shared/components/toggle/toggle.component';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ConfirmationModalComponent } from '../../../../../../shared/components/confirmation-modal/confirmation-modal.component';

@Component({
  selector: 'app-categories-tab',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ButtonComponent,
    InputComponent,
    TextareaComponent,
    ToggleComponent,
    ModalComponent,
    IconComponent,
    ConfirmationModalComponent
],
  template: `
    <div class="p-4 md:p-6">
      <!-- Header -->
      <div class="flex items-center justify-between mb-6">
        <div>
          <h3 class="text-lg font-semibold text-text-primary">Categorías</h3>
          <p class="text-xs text-text-secondary mt-0.5">
            Gestiona las categorías de artículos del centro de ayuda.
          </p>
        </div>
        <app-button
          variant="primary"
          size="sm"
          iconName="plus"
          (clicked)="openCreateModal()"
          >
          Nueva categoría
        </app-button>
      </div>
    
      <!-- Loading -->
      @if (loading()) {
        <div class="flex items-center justify-center py-10">
          <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
        </div>
      }
    
      <!-- Empty State -->
      @if (!loading() && categories().length === 0) {
        <div class="text-center py-10">
          <app-icon name="folder" size="40" class="text-text-tertiary mb-2"></app-icon>
          <p class="text-text-secondary">No hay categorías creadas</p>
        </div>
      }
    
      <!-- Categories Grid -->
      @if (!loading() && categories().length > 0) {
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          @for (category of categories(); track category) {
            <div
              class="border border-border rounded-lg p-4 bg-surface hover:shadow-sm transition-shadow"
              >
              <div class="flex items-start justify-between">
                <div class="flex items-center gap-3">
                  <div class="p-2 rounded-lg bg-primary-50">
                    <app-icon [name]="category.icon || 'folder'" size="20" class="text-primary-600"></app-icon>
                  </div>
                  <div>
                    <h4 class="font-medium text-text-primary">{{ category.name }}</h4>
                    <p class="text-xs text-text-secondary mt-0.5">
                      {{ category._count?.articles || 0 }} artículos
                    </p>
                  </div>
                </div>
                <div class="flex items-center gap-1">
                  <span
                    class="inline-flex px-2 py-0.5 text-xs rounded-full"
                    [class.bg-green-100]="category.is_active"
                    [class.text-green-700]="category.is_active"
                    [class.bg-gray-100]="!category.is_active"
                    [class.text-gray-600]="!category.is_active"
                    >
                    {{ category.is_active ? 'Activa' : 'Inactiva' }}
                  </span>
                </div>
              </div>
              @if (category.description) {
                <p class="text-xs text-text-secondary mt-2 line-clamp-2">
                  {{ category.description }}
                </p>
              }
              <div class="flex items-center gap-2 mt-3 pt-3 border-t border-border">
                <app-button variant="ghost" size="sm" iconName="edit-2" (clicked)="openEditModal(category)">
                  Editar
                </app-button>
                <app-button
                  variant="ghost"
                  size="sm"
                  iconName="trash-2"
                  (clicked)="confirmDelete(category)"
                  [disabled]="(category._count?.articles || 0) > 0"
                  >
                  Eliminar
                </app-button>
              </div>
            </div>
          }
        </div>
      }
    </div>
    
    <!-- Create/Edit Modal -->
    <app-modal
      [(isOpen)]="isModalOpen"
      [title]="editingCategory ? 'Editar Categoría' : 'Nueva Categoría'"
      size="md"
      >
      <form [formGroup]="categoryForm" (ngSubmit)="onSaveCategory()" class="flex flex-col gap-4">
        <app-input
          label="Nombre"
          placeholder="Nombre de la categoría"
          [formControl]="$any(categoryForm.get('name'))"
          [required]="true"
        ></app-input>
    
        <app-textarea
          label="Descripción"
          placeholder="Breve descripción (opcional)"
          [formControl]="$any(categoryForm.get('description'))"
          [rows]="2"
        ></app-textarea>
    
        <app-input
          label="Ícono (Lucide)"
          placeholder="Ej: book-open, help-circle"
          [formControl]="$any(categoryForm.get('icon'))"
        ></app-input>
    
        <app-input
          label="Orden"
          type="number"
          placeholder="0"
          [formControl]="$any(categoryForm.get('sort_order'))"
        ></app-input>
    
        <app-toggle
          label="Categoría activa"
          [formControl]="$any(categoryForm.get('is_active'))"
        ></app-toggle>
    
        <div class="flex justify-end gap-3 mt-2">
          <app-button variant="outline" size="sm" (clicked)="closeModal()">
            Cancelar
          </app-button>
          <app-button
            variant="primary"
            size="sm"
            type="submit"
            [disabled]="modalSubmitting() || categoryForm.invalid"
            >
            {{ modalSubmitting() ? 'Guardando...' : 'Guardar' }}
          </app-button>
        </div>
      </form>
    </app-modal>
    
    <!-- Delete Confirmation -->
    <app-confirmation-modal
      [(isOpen)]="isDeleteConfirmOpen"
      title="Eliminar Categoría"
      message="¿Estás seguro de eliminar esta categoría? Solo es posible si no tiene artículos asociados."
      confirmText="Eliminar"
      confirmVariant="danger"
      (confirm)="onConfirmDelete()"
      (cancel)="isDeleteConfirmOpen = false"
    ></app-confirmation-modal>
    `,
})
export class CategoriesTabComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private fb = inject(FormBuilder);
  private service = inject(HelpCenterAdminService);
  private toast = inject(ToastService);

  categories = signal<HelpCategory[]>([]);
  loading = signal(false);
  modalSubmitting = signal(false);

  isModalOpen = false;
  editingCategory: HelpCategory | null = null;

  isDeleteConfirmOpen = false;
  categoryToDelete: HelpCategory | null = null;

  categoryForm: FormGroup = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(100)]],
    description: [''],
    icon: [''],
    sort_order: [0],
    is_active: [true],
  });

  ngOnInit() {
    this.loadCategories();
  }

  loadCategories() {
    this.loading.set(true);
    this.service.getCategories().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (cats) => {
        this.categories.set(cats);
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Error loading categories', err);
        this.toast.error('Error al cargar las categorías');
        this.loading.set(false);
      },
    });
  }

  openCreateModal() {
    this.editingCategory = null;
    this.categoryForm.reset({ name: '', description: '', icon: '', sort_order: 0, is_active: true });
    this.isModalOpen = true;
  }

  openEditModal(category: HelpCategory) {
    this.editingCategory = category;
    this.categoryForm.patchValue({
      name: category.name,
      description: category.description || '',
      icon: category.icon || '',
      sort_order: category.sort_order,
      is_active: category.is_active,
    });
    this.isModalOpen = true;
  }

  closeModal() {
    this.isModalOpen = false;
    this.editingCategory = null;
    this.modalSubmitting.set(false);
  }

  onSaveCategory() {
    if (this.categoryForm.invalid) return;

    this.modalSubmitting.set(true);
    const dto = this.categoryForm.value;

    const request$ = this.editingCategory
      ? this.service.updateCategory(this.editingCategory.id, dto)
      : this.service.createCategory(dto);

    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.toast.success(
          this.editingCategory ? 'Categoría actualizada' : 'Categoría creada',
        );
        this.closeModal();
        this.loadCategories();
      },
      error: (err) => {
        console.error('Error saving category', err);
        this.toast.error('Error al guardar la categoría');
        this.modalSubmitting.set(false);
      },
    });
  }

  confirmDelete(category: HelpCategory) {
    this.categoryToDelete = category;
    this.isDeleteConfirmOpen = true;
  }

  onConfirmDelete() {
    if (!this.categoryToDelete) return;
    this.service.deleteCategory(this.categoryToDelete.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.toast.success('Categoría eliminada');
        this.isDeleteConfirmOpen = false;
        this.categoryToDelete = null;
        this.loadCategories();
      },
      error: (err) => {
        console.error('Error deleting category', err);
        this.toast.error('Error al eliminar la categoría. Verifica que no tenga artículos asociados.');
      },
    });
  }
}
