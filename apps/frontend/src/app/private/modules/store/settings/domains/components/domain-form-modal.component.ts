import {
  Component,
  input,
  output,
  model,
  OnInit,
  OnChanges,
  SimpleChanges,
  ChangeDetectionStrategy,
  signal,
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
  DnsInstructions,
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
  readonly dnsInstructions = input<DnsInstructions | null>(null);
  readonly isOpenChange = output<boolean>();
  readonly save = output<CreateStoreDomainDto>();
  readonly verify = output<StoreDomain>();

  readonly copied = signal(false);

  form: FormGroup;
  vendixDomain = environment.vendixDomain;

  domainTypeOptions: SelectorOption[] = [
    { value: 'store', label: 'Tienda' },
    { value: 'ecommerce', label: 'E-commerce' },
  ];

  appTypeOptions: SelectorOption[] = [
    { value: 'STORE_ECOMMERCE', label: 'E-commerce' },
    { value: 'STORE_LANDING', label: 'Landing de tienda' },
    { value: 'STORE_ADMIN', label: 'Admin de tienda' },
  ];

  ownershipOptions: SelectorOption[] = [
    { value: 'vendix_subdomain', label: 'Subdominio Vendix' },
    { value: 'custom_domain', label: 'Dominio Propio' },
    { value: 'custom_subdomain', label: 'Subdominio Propio' },
  ];

  constructor(private fb: FormBuilder) {
    this.form = this.fb.group({
      hostname: ['', [Validators.required]],
      app_type: ['STORE_ECOMMERCE', [Validators.required]],
      domain_type: ['ecommerce', [Validators.required]],
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
        app_type: currentDomain.app_type,
        domain_type: currentDomain.domain_type,
        ownership: currentDomain.ownership,
        is_primary: currentDomain.is_primary,
      });
      this.form.get('hostname')?.disable();
    } else if (changes['isOpen'] && this.isOpen() && !currentDomain) {
      this.form.reset({
        hostname: '',
        app_type: 'STORE_ECOMMERCE',
        domain_type: 'ecommerce',
        ownership: 'vendix_subdomain',
        is_primary: false,
      });
      this.form.get('hostname')?.enable();
    }
  }

  onCancel(): void {
    this.isOpenChange.emit(false);
  }

  onVerify(): void {
    const currentDomain = this.domain();
    if (currentDomain) {
      this.verify.emit(currentDomain);
    }
  }

  copyToClipboard(value: string): void {
    if (!value) return;
    navigator.clipboard?.writeText(value).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1800);
    });
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

  get isCustomDomain(): boolean {
    const ownership = this.domain()?.ownership || this.form.get('ownership')?.value;
    return ownership === 'custom_domain' || ownership === 'custom_subdomain';
  }
}
