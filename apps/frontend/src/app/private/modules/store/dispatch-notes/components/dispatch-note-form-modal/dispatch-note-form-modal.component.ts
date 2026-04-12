import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnChanges,
  SimpleChanges,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, FormArray, Validators } from '@angular/forms';
import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  ModalComponent,
} from '../../../../../../shared/components/index';
import {
  DispatchNote,
  CreateDispatchNoteDto,
  CreateDispatchNoteItemDto,
} from '../../interfaces/dispatch-note.interface';
import { toLocalDateString } from '../../../../../../shared/utils/date.util';

@Component({
  selector: 'app-dispatch-note-form-modal',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ButtonComponent,
    IconComponent,
    InputComponent,
    ModalComponent,
  ],
  templateUrl: './dispatch-note-form-modal.component.html',
})
export class DispatchNoteFormModalComponent implements OnInit, OnChanges {
  private fb = inject(FormBuilder);

  @Input() dispatch_note: DispatchNote | null = null;
  @Input() is_open = false;

  @Output() save = new EventEmitter<CreateDispatchNoteDto>();
  @Output() closed = new EventEmitter<void>();

  form!: FormGroup;
  is_edit_mode = false;

  ngOnInit(): void {
    this.initForm();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['is_open'] && this.is_open) {
      this.initForm();
      if (this.dispatch_note) {
        this.is_edit_mode = true;
        this.patchForm(this.dispatch_note);
      } else {
        this.is_edit_mode = false;
      }
    }
  }

  private initForm(): void {
    this.form = this.fb.group({
      customer_id: [null, Validators.required],
      dispatch_location_id: [null],
      emission_date: [toLocalDateString()],
      agreed_delivery_date: [null],
      notes: [''],
      internal_notes: [''],
      currency: ['COP'],
      items: this.fb.array([]),
    });
  }

  private patchForm(dn: DispatchNote): void {
    this.form.patchValue({
      customer_id: dn.customer_id,
      dispatch_location_id: dn.dispatch_location_id,
      emission_date: dn.emission_date ? dn.emission_date.split('T')[0] : '',
      agreed_delivery_date: dn.agreed_delivery_date ? dn.agreed_delivery_date.split('T')[0] : '',
      notes: dn.notes || '',
      internal_notes: dn.internal_notes || '',
      currency: dn.currency || 'COP',
    });

    this.items.clear();
    if (dn.dispatch_note_items) {
      dn.dispatch_note_items.forEach((item) => {
        this.items.push(this.fb.group({
          product_id: [item.product_id, Validators.required],
          product_variant_id: [item.product_variant_id],
          location_id: [item.location_id],
          ordered_quantity: [item.ordered_quantity, [Validators.required, Validators.min(0)]],
          dispatched_quantity: [item.dispatched_quantity, [Validators.required, Validators.min(0)]],
          unit_price: [item.unit_price],
          discount_amount: [item.discount_amount],
          tax_amount: [item.tax_amount],
          lot_serial: [item.lot_serial || ''],
          sales_order_item_id: [item.sales_order_item_id],
        }));
      });
    }
  }

  get items(): FormArray {
    return this.form.get('items') as FormArray;
  }

  addItem(): void {
    this.items.push(this.fb.group({
      product_id: [null, Validators.required],
      product_variant_id: [null],
      location_id: [null],
      ordered_quantity: [1, [Validators.required, Validators.min(0)]],
      dispatched_quantity: [1, [Validators.required, Validators.min(0)]],
      unit_price: [0],
      discount_amount: [0],
      tax_amount: [0],
      lot_serial: [''],
      sales_order_item_id: [null],
    }));
  }

  removeItem(index: number): void {
    this.items.removeAt(index);
  }

  getItemTotal(index: number): number {
    const item = this.items.at(index);
    const qty = item.get('dispatched_quantity')?.value || 0;
    const price = item.get('unit_price')?.value || 0;
    const discount = item.get('discount_amount')?.value || 0;
    const tax = item.get('tax_amount')?.value || 0;
    return (qty * price) - discount + tax;
  }

  get subtotal_amount(): number {
    let total = 0;
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items.at(i);
      const qty = item.get('dispatched_quantity')?.value || 0;
      const price = item.get('unit_price')?.value || 0;
      total += qty * price;
    }
    return total;
  }

  get discount_total(): number {
    let total = 0;
    for (let i = 0; i < this.items.length; i++) {
      total += this.items.at(i).get('discount_amount')?.value || 0;
    }
    return total;
  }

  get tax_total(): number {
    let total = 0;
    for (let i = 0; i < this.items.length; i++) {
      total += this.items.at(i).get('tax_amount')?.value || 0;
    }
    return total;
  }

  get grand_total(): number {
    return this.subtotal_amount - this.discount_total + this.tax_total;
  }

  handleSubmit(): void {
    if (this.form.invalid) return;

    const value = this.form.value;
    const dto: CreateDispatchNoteDto = {
      customer_id: value.customer_id,
      dispatch_location_id: value.dispatch_location_id,
      emission_date: value.emission_date,
      agreed_delivery_date: value.agreed_delivery_date,
      notes: value.notes,
      internal_notes: value.internal_notes,
      currency: value.currency,
      items: value.items.map((item: any): CreateDispatchNoteItemDto => ({
        product_id: item.product_id,
        product_variant_id: item.product_variant_id,
        location_id: item.location_id,
        ordered_quantity: item.ordered_quantity,
        dispatched_quantity: item.dispatched_quantity,
        unit_price: item.unit_price,
        discount_amount: item.discount_amount,
        tax_amount: item.tax_amount,
        lot_serial: item.lot_serial,
        sales_order_item_id: item.sales_order_item_id,
      })),
    };

    this.save.emit(dto);
  }

  handleClose(): void {
    this.closed.emit();
  }
}
