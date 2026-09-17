import { Component, OnInit, inject, signal, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { VideoLibraryAdminService } from '../../services/video-library-admin.service';
import { VideoCategory } from '../../../../store/help/video-library/models/video.model';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import { TextareaComponent } from '../../../../../../shared/components/textarea/textarea.component';
import { ToggleComponent } from '../../../../../../shared/components/toggle/toggle.component';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ConfirmationModalComponent } from '../../../../../../shared/components/confirmation-modal/confirmation-modal.component';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';

@Component({
  selector: 'app-video-categories-tab',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ButtonComponent,
    InputComponent,
    TextareaComponent,
    ToggleComponent,
    ModalComponent,
    IconComponent,
    ConfirmationModalComponent,
  ],
  template: `
    <div class="p-4 md:p-6">
      <div class="flex items-center justify-between mb-6">
        <div>
          <h3 class="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Categorías de Videos</h3>
          <p class="text-xs text-neutral-500 mt-0.5">
            Organiza las temáticas de los videos de capacitación (POS, Inventario, DIAN, etc.).
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

      @if (loading()) {
        <div class="flex items-center justify-center py-12">
          <div class="animate-spin rounded-full h-7 w-7 border-b-2 border-primary"></div>
        </div>
      }

      @if (!loading() && categories().length === 0) {
        <div class="text-center py-12 text-neutral-400">
          <app-icon name="folder" [size]="40" class="mb-2"></app-icon>
          <p class="text-sm">No hay categorías registradas.</p>
        </div>
      }

      @if (!loading() && categories().length > 0) {
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          @for (cat of categories(); track cat.id) {
            <div class="bg-surface rounded-xl border border-neutral-200 dark:border-neutral-800 p-4 flex flex-col justify-between hover:shadow-sm transition-all">
              <div>
                <div class="flex items-start justify-between gap-2">
                  <div class="flex items-center gap-2.5">
                    <div class="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                      <app-icon [name]="cat.icon || 'folder'" [size]="16"></app-icon>
                    </div>
                    <div>
                      <h4 class="text-sm font-bold text-neutral-900 dark:text-neutral-100">{{ cat.name }}</h4>
                      <span class="text-[11px] font-mono text-neutral-400">{{ cat.slug }}</span>
                    </div>
                  </div>
                  <span
                    class="text-[10px] font-bold px-2 py-0.5 rounded-full"
                    [class]="cat.is_active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400' : 'bg-neutral-100 text-neutral-500'"
                  >
                    {{ cat.is_active ? 'Activa' : 'Inactiva' }}
                  </span>
                </div>

                @if (cat.description) {
                  <p class="text-xs text-neutral-500 dark:text-neutral-400 mt-2.5 line-clamp-2">
                    {{ cat.description }}
                  </p>
                }
              </div>

              <div class="flex items-center justify-between pt-3 mt-3 border-t border-neutral-100 dark:border-neutral-800/80 text-xs">
                <span class="text-neutral-400 font-medium">
                  {{ cat._count?.videos || 0 }} videos
                </span>
                <div class="flex items-center gap-1">
                  <button
                    (click)="openEditModal(cat)"
                    class="p-1.5 rounded-lg text-neutral-500 hover:text-primary hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                    title="Editar"
                  >
                    <app-icon name="edit-2" [size]="14"></app-icon>
                  </button>
                  <button
                    (click)="confirmDelete(cat)"
                    class="p-1.5 rounded-lg text-neutral-500 hover:text-red-600 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                    title="Eliminar"
                  >
                    <app-icon name="trash-2" [size]="14"></app-icon>
                  </button>
                </div>
              </div>
            </div>
          }
        </div>
      }

      <!-- Modal Crear / Editar Categoría -->
      <app-modal
        [isOpen]="isModalOpen()"
        (closed)="closeModal()"
        [title]="editingCategory() ? 'Editar Categoría' : 'Nueva Categoría'"
        maxWidth="md"
      >
        <form [formGroup]="form" (ngSubmit)="saveCategory()" class="flex flex-col gap-4 p-4">
          <app-input
            label="Nombre"
            placeholder="ej: Clientes, Inventario, Facturación DIAN"
            [formControl]="$any(form.get('name'))"
            (ngModelChange)="onNameChange($event)"
            [required]="true"
          ></app-input>

          <app-textarea
            label="Descripción"
            placeholder="Breve descripción de esta categoría de videos"
            [formControl]="$any(form.get('description'))"
            [rows]="2"
          ></app-textarea>

          <div>
            <label class="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1.5">
              Icono del Módulo (Lucide)
            </label>
            <div class="flex items-center gap-2 mb-2">
              <div class="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
                <app-icon [name]="form.get('icon')?.value || 'folder'" [size]="20"></app-icon>
              </div>
              <div class="flex-1">
                <app-input
                  placeholder="ej: users, package, warehouse, store"
                  [formControl]="$any(form.get('icon'))"
                ></app-input>
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-1.5 mt-1">
              <span class="text-[11px] text-neutral-400 mr-1">Módulos:</span>
              @for (preset of moduleIconPresets; track preset.icon) {
                <button
                  type="button"
                  (click)="selectIconPreset(preset.icon)"
                  class="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border transition-colors cursor-pointer"
                  [class]="form.get('icon')?.value === preset.icon
                    ? 'bg-primary text-white border-primary shadow-sm'
                    : 'bg-neutral-50 dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800 text-neutral-600 dark:text-neutral-300 hover:border-primary/40'"
                  [title]="preset.name"
                >
                  <app-icon [name]="preset.icon" [size]="12"></app-icon>
                  <span>{{ preset.name }}</span>
                </button>
              }
            </div>
          </div>

          <div class="flex items-center justify-between pt-2">
            <app-toggle
              label="Activa para tiendas"
              [formControl]="$any(form.get('is_active'))"
            ></app-toggle>
          </div>

          <div class="flex justify-end gap-2 pt-4 border-t border-neutral-100 dark:border-neutral-800">
            <app-button variant="outline" size="sm" (clicked)="closeModal()">
              Cancelar
            </app-button>
            <app-button variant="primary" size="sm" type="submit" [disabled]="form.invalid || saving()">
              {{ saving() ? 'Guardando...' : (editingCategory() ? 'Guardar Cambios' : 'Crear Categoría') }}
            </app-button>
          </div>
        </form>
      </app-modal>

      <!-- Confirmation Modal -->
      <app-confirmation-modal
        [(isOpen)]="isDeleteModalOpen"
        title="Eliminar Categoría"
        [message]="'¿Estás seguro de eliminar la categoría \\'' + (categoryToDelete()?.name || '') + '\\'?'"
        confirmText="Eliminar"
        confirmVariant="danger"
        (confirm)="deleteCategory()"
        (cancel)="isDeleteModalOpen.set(false)"
      ></app-confirmation-modal>
    </div>
  `,
})
export class VideoCategoriesTabComponent implements OnInit {
  private videoService = inject(VideoLibraryAdminService);
  private fb = inject(FormBuilder);
  private toast = inject(ToastService);
  private destroyRef = inject(DestroyRef);

  categories = signal<VideoCategory[]>([]);
  loading = signal<boolean>(true);
  saving = signal<boolean>(false);
  isModalOpen = signal<boolean>(false);
  isDeleteModalOpen = signal<boolean>(false);
  editingCategory = signal<VideoCategory | null>(null);
  categoryToDelete = signal<VideoCategory | null>(null);

  readonly moduleIconPresets = [
    { name: 'Clientes', icon: 'users' },
    { name: 'Productos', icon: 'package' },
    { name: 'Inventario', icon: 'warehouse' },
    { name: 'Punto de Venta (POS)', icon: 'shopping-cart' },
    { name: 'Facturación / DIAN', icon: 'file-text' },
    { name: 'Restaurante / Mesas', icon: 'utensils' },
    { name: 'Configuración', icon: 'settings' },
    { name: 'Primeros Pasos', icon: 'rocket' },
    { name: 'Proveedores / Envíos', icon: 'truck' },
    { name: 'Finanzas', icon: 'dollar-sign' },
    { name: 'Soporte / Ayuda', icon: 'help-circle' },
    { name: 'General', icon: 'folder' },
  ];

  form: FormGroup = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(100)]],
    description: ['', [Validators.maxLength(500)]],
    icon: ['folder', [Validators.maxLength(50)]],
    is_active: [true],
  });

  ngOnInit() {
    this.loadCategories();
  }

  selectIconPreset(icon: string) {
    this.form.patchValue({ icon });
  }

  onNameChange(name: string) {
    if (this.editingCategory()) return;
    const lower = (name || '').toLowerCase().trim();
    if (lower.includes('client')) {
      this.form.patchValue({ icon: 'users' });
    } else if (lower.includes('product')) {
      this.form.patchValue({ icon: 'package' });
    } else if (lower.includes('inventari') || lower.includes('stock')) {
      this.form.patchValue({ icon: 'warehouse' });
    } else if (lower.includes('pos') || lower.includes('venta') || lower.includes('punto')) {
      this.form.patchValue({ icon: 'shopping-cart' });
    } else if (lower.includes('factur') || lower.includes('dian') || lower.includes('recibo')) {
      this.form.patchValue({ icon: 'file-text' });
    } else if (lower.includes('restauran') || lower.includes('mesa') || lower.includes('cocina')) {
      this.form.patchValue({ icon: 'utensils' });
    } else if (lower.includes('config') || lower.includes('ajuste')) {
      this.form.patchValue({ icon: 'settings' });
    } else if (lower.includes('paso') || lower.includes('inici') || lower.includes('comenzar')) {
      this.form.patchValue({ icon: 'rocket' });
    } else if (lower.includes('envi') || lower.includes('proveedor') || lower.includes('ruta')) {
      this.form.patchValue({ icon: 'truck' });
    } else if (lower.includes('soport') || lower.includes('ayuda')) {
      this.form.patchValue({ icon: 'help-circle' });
    } else if (lower.includes('nomina') || lower.includes('finanz') || lower.includes('precio')) {
      this.form.patchValue({ icon: 'dollar-sign' });
    }
  }

  loadCategories() {
    this.loading.set(true);
    this.videoService
      .getCategories()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (cats) => {
          this.categories.set(cats);
          this.loading.set(false);
        },
        error: (err) => {
          const parsed = parseApiError(err);
          this.toast.error(parsed.userMessage || 'Error al cargar categorías');
          this.loading.set(false);
        },
      });
  }

  openCreateModal() {
    this.editingCategory.set(null);
    this.form.reset({ name: '', description: '', icon: 'folder', is_active: true });
    this.isModalOpen.set(true);
  }

  openEditModal(cat: VideoCategory) {
    this.editingCategory.set(cat);
    this.form.patchValue({
      name: cat.name,
      description: cat.description,
      icon: cat.icon || 'folder',
      is_active: cat.is_active,
    });
    this.isModalOpen.set(true);
  }

  closeModal() {
    this.isModalOpen.set(false);
    this.editingCategory.set(null);
  }

  saveCategory() {
    if (this.form.invalid) return;
    this.saving.set(true);
    const val = this.form.value;

    const op = this.editingCategory()
      ? this.videoService.updateCategory(this.editingCategory()!.id, val)
      : this.videoService.createCategory(val);

    op.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.toast.success(this.editingCategory() ? 'Categoría actualizada' : 'Categoría creada');
        this.saving.set(false);
        this.closeModal();
        this.loadCategories();
      },
      error: (err) => {
        const parsed = parseApiError(err);
        this.toast.error(parsed.userMessage || 'Error al guardar categoría');
        this.saving.set(false);
      },
    });
  }

  confirmDelete(cat: VideoCategory) {
    this.categoryToDelete.set(cat);
    this.isDeleteModalOpen.set(true);
  }

  deleteCategory() {
    const cat = this.categoryToDelete();
    if (!cat) return;

    this.videoService
      .deleteCategory(cat.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Categoría eliminada');
          this.isDeleteModalOpen.set(false);
          this.loadCategories();
        },
        error: (err) => {
          const parsed = parseApiError(err);
          this.toast.error(parsed.userMessage || 'Error al eliminar la categoría');
          this.isDeleteModalOpen.set(false);
        },
      });
  }
}
