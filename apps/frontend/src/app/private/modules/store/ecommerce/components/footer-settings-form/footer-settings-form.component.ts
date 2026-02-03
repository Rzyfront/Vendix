import { Component, EventEmitter, inject, Input, OnChanges, OnInit, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { debounceTime, filter, skip } from 'rxjs';

import {
  InputComponent,
  IconComponent,
} from '../../../../../../shared/components';
import {
  FooterSettings,
  FooterLink,
  FooterFaqItem,
  FooterStoreInfo,
  FooterHelp,
  FooterSocial,
} from '../../interfaces';

@Component({
  selector: 'app-footer-settings-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    InputComponent,
    IconComponent,
  ],
  templateUrl: './footer-settings-form.component.html',
})
export class FooterSettingsFormComponent implements OnInit, OnChanges {
  private fb = inject(FormBuilder);

  @Input() initialData?: FooterSettings;
  @Output() valueChange = new EventEmitter<FooterSettings>();

  footerForm!: FormGroup;

  // Flag to skip emission during initial patch
  private isPatching = false;

  // Track expanded sections
  expandedSections = {
    store_info: true,
    links: true,
    help: true,
    social: true,
  };

  // Track expanded FAQ items
  expandedFaqIndex: number | null = null;

  ngOnInit(): void {
    this.createForm();
    if (this.initialData) {
      this.isPatching = true;
      this.patchForm(this.initialData);
      this.isPatching = false;
    }

    // Emit changes with debounce - skip emissions during patching
    this.footerForm.valueChanges
      .pipe(
        filter(() => !this.isPatching),
        debounceTime(300),
      )
      .subscribe(() => {
        if (this.footerForm.valid) {
          this.valueChange.emit(this.getFormValue());
        }
      });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['initialData'] && !changes['initialData'].firstChange && this.footerForm) {
      this.isPatching = true;
      this.patchForm(this.initialData);
      this.isPatching = false;
    }
  }

  private createForm(): void {
    this.footerForm = this.fb.group({
      store_info: this.fb.group({
        about_us: [''],
        support_email: ['', Validators.email],
        tagline: [''],
      }),
      links: this.fb.array([]),
      help: this.fb.group({
        faq: this.fb.array([]),
        shipping_info: [''],
        returns_info: [''],
      }),
      social: this.fb.group({
        facebook: this.fb.group({
          username: [''],
          url: [''],
        }),
        instagram: this.fb.group({
          username: [''],
          url: [''],
        }),
        tiktok: this.fb.group({
          username: [''],
          url: [''],
        }),
      }),
    });
  }

  private patchForm(data?: FooterSettings): void {
    if (!data) return;

    // Patch store_info
    if (data.store_info) {
      this.footerForm.get('store_info')?.patchValue(data.store_info);
    }

    // Patch links
    this.linksArray.clear();
    if (data.links?.length) {
      data.links.forEach((link) => this.addLink(link));
    }

    // Patch help
    if (data.help) {
      this.footerForm.get('help')?.patchValue({
        shipping_info: data.help.shipping_info || '',
        returns_info: data.help.returns_info || '',
      });

      // Patch FAQ array
      this.faqArray.clear();
      if (data.help.faq?.length) {
        data.help.faq.forEach((item) => this.addFaqItem(item));
      }
    }

    // Patch social
    if (data.social) {
      this.footerForm.get('social')?.patchValue(data.social);
    }
  }

  // Getters for FormArrays
  get linksArray(): FormArray {
    return this.footerForm.get('links') as FormArray;
  }

  get faqArray(): FormArray {
    return this.footerForm.get('help.faq') as FormArray;
  }

  // Link methods
  addLink(link?: FooterLink): void {
    if (this.linksArray.length >= 5) return;

    const linkGroup = this.fb.group({
      label: [link?.label || '', Validators.required],
      url: [link?.url || '', Validators.required],
      is_external: [link?.is_external || false],
    });

    this.linksArray.push(linkGroup);
  }

  removeLink(index: number): void {
    this.linksArray.removeAt(index);
  }

  // FAQ methods
  addFaqItem(item?: FooterFaqItem): void {
    const faqGroup = this.fb.group({
      question: [item?.question || '', Validators.required],
      answer: [item?.answer || '', Validators.required],
    });

    this.faqArray.push(faqGroup);

    // Expand the new item if adding manually
    if (!item) {
      this.expandedFaqIndex = this.faqArray.length - 1;
    }
  }

  removeFaqItem(index: number): void {
    this.faqArray.removeAt(index);
    if (this.expandedFaqIndex === index) {
      this.expandedFaqIndex = null;
    }
  }

  toggleFaqItem(index: number): void {
    this.expandedFaqIndex = this.expandedFaqIndex === index ? null : index;
  }

  // Section toggle
  toggleSection(section: keyof typeof this.expandedSections): void {
    this.expandedSections[section] = !this.expandedSections[section];
  }

  // Get form value properly formatted
  private getFormValue(): FooterSettings {
    const value = this.footerForm.value;

    return {
      store_info: value.store_info as FooterStoreInfo,
      links: value.links as FooterLink[],
      help: {
        faq: value.help.faq as FooterFaqItem[],
        shipping_info: value.help.shipping_info,
        returns_info: value.help.returns_info,
      } as FooterHelp,
      social: value.social as FooterSocial,
    };
  }
}
