import { Component, SimpleChanges, input, output, inject } from '@angular/core';
import {
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';

import {
  ModalComponent,
  ButtonComponent,
  InputComponent,
} from '../../../../../../shared/components/index';
import {
  NotificationSoundAdmin,
  UpdateNotificationSoundPayload,
} from '../../interfaces/notification-sound.interface';

@Component({
  selector: 'app-edit-notification-sound-modal',
  standalone: true,
  imports: [
    FormsModule,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
  ],
  templateUrl: './edit-notification-sound-modal.component.html',
})
export class EditNotificationSoundModalComponent {
  private readonly fb = inject(FormBuilder);

  readonly isOpen = input(false);
  readonly isSubmitting = input(false);
  readonly sound = input<NotificationSoundAdmin | null>(null);

  readonly isOpenChange = output<boolean>();
  readonly submit = output<UpdateNotificationSoundPayload>();

  readonly form: FormGroup = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
    sort_order: [0, [Validators.min(0)]],
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['sound']) {
      const value = this.sound();
      if (value) {
        this.form.patchValue({
          name: value.name,
          sort_order: value.sort_order ?? 0,
        });
      }
    }
  }

  onSubmit(): void {
    if (this.form.invalid) {
      Object.keys(this.form.controls).forEach((key) => {
        this.form.get(key)?.markAsTouched();
      });
      return;
    }
    const { name, sort_order } = this.form.value;
    this.submit.emit({
      name: name?.trim(),
      sort_order: sort_order ?? 0,
    });
  }

  onCancel(): void {
    this.isOpenChange.emit(false);
  }
}
