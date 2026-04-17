import {
  Component,
  input,
  output,
  model,
  OnInit,
  OnChanges,
  SimpleChanges,
  ChangeDetectionStrategy,
} from '@angular/core';

import {
  ReactiveFormsModule,
  FormGroup,
  FormBuilder,
  Validators,
} from '@angular/forms';
import {
  ModalComponent,
  ButtonComponent,
  InputComponent,
  SelectorComponent,
  SelectorOption,
  IconComponent,
} from '../../../../../../shared/components/index';
import {
  CreateStoreDomainDto,
  StoreDomain,
  StoreDomainType,
  StoreDomainOwnership,
} from '../domain.interface';
import { environment } from '../../../../../../../environments/environment';

@Component({
  selector: 'app-domain-form-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
    IconComponent,
  ],
  templateUrl: './domain-form-modal.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DomainFormModalComponent implements OnInit, OnChanges {
  readonly isOpen = model<boolean>(false);
  readonly isSaving = model<boolean>(false);
  readonly domain = input<StoreDomain | null>(null);
  readonly isOpenChange = output<boolean>();
  readonly save = output<CreateStoreDomainDto>();

  form: FormGroup;
  vendixDomain = environment.vendixDomain;

  domainTypeOptions: SelectorOption[] = [
    { value: 'store', label: 'Tienda' },
    { value: 'ecommerce', label: 'E-commerce' },
    { value: 'organization', label: 'Organización' },
  ];

  ownershipOptions: SelectorOption[] = [
    { value: 'vendix_subdomain', label: 'Subdominio Vendix' },
    { value: 'custom_domain', label: 'Dominio Propio' },
    { value: 'custom_subdomain', label: 'Subdominio Propio' },
  ];

  constructor(private fb: FormBuilder) {
    this.form = this.fb.group({
      hostname: ['', [Validators.required]],
      domain_type: ['store', [Validators.required]],
      ownership: ['vendix_subdomain', [Validators.required]],
      is_primary: [false],
    });
  }

  ngOnInit(): void {}

  ngOnChanges(changes: SimpleChanges): void {
    const currentDomain = this.domain();
    if (changes['domain'] && currentDomain) {
      this.form.patchValue({
        hostname: currentDomain.hostname,
        domain_type: currentDomain.domain_type,
        ownership: currentDomain.ownership,
        is_primary: currentDomain.is_primary,
      });
      this.form.get('hostname')?.disable();
    } else if (changes['isOpen'] && this.isOpen() && !currentDomain) {
      this.form.reset({
        hostname: '',
        domain_type: 'store',
        ownership: 'vendix_subdomain',
        is_primary: false,
      });
      this.form.get('hostname')?.enable();
    }
  }

  onCancel(): void {
    this.isOpenChange.emit(false);
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const formValue = this.form.getRawValue();
    const currentDomain = this.domain();
    this.save.emit({
      ...formValue,
      config: currentDomain?.config || {},
    });
  }

  get isEditing(): boolean {
    return !!this.domain();
  }
}
