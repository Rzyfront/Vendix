import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
  OnInit,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
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
    CommonModule,
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
  @Input() isOpen = false;
  @Input() isSaving = false;
  @Input() domain: StoreDomain | null = null;
  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() save = new EventEmitter<CreateStoreDomainDto>();

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
    if (changes['domain'] && this.domain) {
      this.form.patchValue({
        hostname: this.domain.hostname,
        domain_type: this.domain.domain_type,
        ownership: this.domain.ownership,
        is_primary: this.domain.is_primary,
      });
      this.form.get('hostname')?.disable();
    } else if (changes['isOpen'] && this.isOpen && !this.domain) {
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
    this.save.emit({
      ...formValue,
      config: this.domain?.config || {},
    });
  }

  get isEditing(): boolean {
    return !!this.domain;
  }
}
