import { Component, input, output, provideZonelessChangeDetection } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { SupportDocumentCreateComponent } from './support-document-create.component';
import { SupportDocumentService } from '../../services/support-document.service';
import { SuppliersService } from '../../../inventory/services/suppliers.service';
import { SupplierFormModalComponent } from '../../../inventory/suppliers/components/supplier-form-modal.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import type {
  PurchaseOrderSupportDraft,
  SupportMissingField,
} from '../../interfaces/support-document.interface';

/** Stand-in for the supplier form modal: only the inputs/outputs the host binds. */
@Component({ selector: 'app-supplier-form-modal', standalone: true, template: '' })
class SupplierFormModalStub {
  readonly isOpen = input(false);
  readonly supplier = input<unknown>(null);
  readonly isSubmitting = input(false);
  readonly isOpenChange = output<boolean>();
  readonly cancel = output<void>();
  readonly save = output<unknown>();
}

describe('SupportDocumentCreateComponent — OC mode (QUI-684)', () => {
  const draftFixture = (
    overrides: Partial<PurchaseOrderSupportDraft> = {},
  ): PurchaseOrderSupportDraft => ({
    purchase_order: {
      id: 9,
      order_number: 'OC-9',
      status: 'received',
      supplier_id: 5,
      total_amount: 119000,
      has_supplier_invoice: false,
      supplier_invoice_number: null,
      supplier_invoice_date: null,
      invoice_attachments_count: 0,
    },
    active_document: null,
    supplier: {
      id: 5,
      name: 'Proveedor No Obligado SAS',
      document_type: '13',
      tax_id: '123456789',
      verification_digit: null,
      address_line1: 'Calle 1',
      city: 'Bogotá',
      municipality_code: '11001',
    },
    draft: {
      supplier_id: 5,
      issue_date: '2026-11-17',
      due_date: null,
      payment_form: '1',
      notes: 'Compra OC-9',
      withholding_amount: 0,
      items: [
        {
          description: 'Cemento gris',
          quantity: 10,
          unit_price: 10000,
          discount_amount: 0,
          tax_amount: 19000,
        },
      ],
    },
    missing: [],
    can_emit: true,
    ...overrides,
  });

  let service: {
    getPurchaseOrderDraft: jasmine.Spy;
    createFromPurchaseOrder: jasmine.Spy;
    create: jasmine.Spy;
  };
  let suppliers: { getSuppliers: jasmine.Spy; getSupplierById: jasmine.Spy; updateSupplier: jasmine.Spy };

  const setup = (
    draft: PurchaseOrderSupportDraft | null,
    purchaseOrderId: number | null = 9,
  ): ComponentFixture<SupportDocumentCreateComponent> => {
    service = {
      getPurchaseOrderDraft: jasmine
        .createSpy('getPurchaseOrderDraft')
        .and.returnValue(of({ success: true, data: draft })),
      createFromPurchaseOrder: jasmine
        .createSpy('createFromPurchaseOrder')
        .and.returnValue(
          of({ success: true, data: { id: 1, emission: { attempted: true, success: true, status: 'accepted' } } }),
        ),
      create: jasmine.createSpy('create').and.returnValue(of({ success: true, data: { id: 2 } })),
    };
    suppliers = {
      getSuppliers: jasmine.createSpy('getSuppliers').and.returnValue(of({ data: [] })),
      getSupplierById: jasmine.createSpy('getSupplierById').and.returnValue(of({ data: { id: 5 } })),
      updateSupplier: jasmine.createSpy('updateSupplier').and.returnValue(of({ data: { id: 5 } })),
    };

    TestBed.configureTestingModule({
      imports: [SupportDocumentCreateComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: SupportDocumentService, useValue: service },
        { provide: SuppliersService, useValue: suppliers },
        {
          provide: ToastService,
          useValue: { success: jasmine.createSpy('success'), error: jasmine.createSpy('error') },
        },
        {
          provide: CurrencyFormatService,
          useValue: {
            loadCurrency: () => undefined,
            currencyFormatStyle: () => 'dot_comma',
            currencyDecimals: () => 0,
            format: (v: number) => `$${Math.round(v)}`,
          },
        },
      ],
    });
    TestBed.overrideComponent(SupportDocumentCreateComponent, {
      remove: { imports: [SupplierFormModalComponent] },
      add: { imports: [SupplierFormModalStub] },
    });
    const fixture = TestBed.createComponent(SupportDocumentCreateComponent);
    fixture.componentRef.setInput('purchaseOrderId', purchaseOrderId);
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();
    fixture.detectChanges();
    return fixture;
  };

  const text = (f: ComponentFixture<unknown>): string =>
    (f.nativeElement as HTMLElement).textContent ?? '';

  const missing = (
    code: string,
    target: SupportMissingField['target'],
    label: string,
    field = '',
  ): SupportMissingField => ({ code, field, label, target });

  it('prefills the locked supplier, items, dates and payment form from the draft', () => {
    const f = setup(draftFixture());
    const c = f.componentInstance;

    expect(service.getPurchaseOrderDraft).toHaveBeenCalledOnceWith(9);
    expect(suppliers.getSuppliers).not.toHaveBeenCalled();
    expect(text(f)).toContain('Proveedor No Obligado SAS');
    expect(text(f)).toContain('123456789');
    expect((f.nativeElement as HTMLElement).querySelector('app-selector[formcontrolname="supplier_id"]')).toBeNull();
    expect(c.form.value.supplier_id).toBe(5);
    expect(c.form.value.issue_date).toBe('2026-11-17');
    expect(c.form.value.payment_form).toBe('1');
    expect(c.itemsArray.length).toBe(1);
    expect(c.itemsArray.at(0).value.description).toBe('Cemento gris');
    expect(text(f)).toContain('Total de la orden de compra');
    expect(c.submitDisabled()).toBeFalse();
  });

  it('shows the informative notice only when the order has a supplier invoice', () => {
    const without = setup(draftFixture());
    expect(text(without)).not.toContain('ya tiene una factura de compra adjunta');
    TestBed.resetTestingModule();

    const base = draftFixture();
    const withInvoice = setup(
      draftFixture({
        purchase_order: {
          ...base.purchase_order,
          has_supplier_invoice: true,
          supplier_invoice_number: 'FC-77',
        },
      }),
    );
    expect(text(withInvoice)).toContain(
      'Esta orden ya tiene una factura de compra adjunta (N° FC-77). Si el proveedor ya te facturó, normalmente no necesitas documento soporte; la decisión es tuya.',
    );
    // Informative: it must not block emission.
    expect(withInvoice.componentInstance.submitDisabled()).toBeFalse();
  });

  it('lists the missing data and blocks submit; review items unblock once fixed in the form', () => {
    const base = draftFixture();
    const f = setup(
      draftFixture({
        // The server flags the line because the OC line really has no description.
        draft: { ...base.draft, items: [{ ...base.draft.items[0], description: '' }] },
        missing: [
          missing('SUPPLIER_MUNICIPALITY_REQUIRED', 'supplier', 'Falta el municipio del proveedor'),
          missing('ITEM_DESCRIPTION_REQUIRED', 'review', 'Falta la descripción del ítem 1', 'items[0].description'),
        ],
        can_emit: false,
      }),
    );
    const c = f.componentInstance;

    expect(text(f)).toContain('Falta el municipio del proveedor');
    expect(text(f)).toContain('Falta la descripción del ítem 1');
    expect(text(f)).toContain('Completar en el proveedor');
    expect(c.submitDisabled()).toBeTrue();

    c.itemsArray.at(0).get('description')?.setValue('Cemento gris 50kg');
    f.detectChanges();
    expect(c.effectiveMissing().map((m) => m.code)).toEqual(['SUPPLIER_MUNICIPALITY_REQUIRED']);
    // The supplier item still blocks.
    expect(c.submitDisabled()).toBeTrue();
  });

  it('blocks submit and offers the active document when the order already has one', () => {
    const f = setup(
      draftFixture({
        active_document: { id: 31, invoice_number: 'DS-31', status: 'accepted' },
        can_emit: false,
      }),
    );
    expect(text(f)).toContain('Esta orden ya tiene el documento soporte N° DS-31 vigente');
    expect(text(f)).toContain('Ver documento');
    expect(f.componentInstance.submitDisabled()).toBeTrue();

    const viewed: number[] = [];
    f.componentInstance.viewDocument.subscribe((id) => viewed.push(id));
    f.componentInstance.viewActiveDocument(31);
    expect(viewed).toEqual([31]);
  });

  it('submits with emit_immediately and a client_request_id stable for the whole open', () => {
    const f = setup(draftFixture());
    const c = f.componentInstance;
    const created: unknown[] = [];
    c.created.subscribe((r) => created.push(r));

    c.onSubmit();

    expect(service.createFromPurchaseOrder).toHaveBeenCalledTimes(1);
    const [poId, dto] = service.createFromPurchaseOrder.calls.mostRecent().args;
    expect(poId).toBe(9);
    expect(dto.emit_immediately).toBeTrue();
    expect(dto.payment_form).toBe('1');
    expect(dto.client_request_id).toEqual(jasmine.any(String));
    expect(dto.items[0].description).toBe('Cemento gris');
    expect(created.length).toBe(1);
    expect(c.emissionResult()?.success).toBeTrue();
    f.detectChanges();
    expect(text(f)).toContain('aceptado por la DIAN');
  });

  it('reuses the same client_request_id when the user retries after an error', () => {
    const f = setup(draftFixture());
    const c = f.componentInstance;
    service.createFromPurchaseOrder.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 500, error: { message: 'x' } })),
    );
    c.onSubmit();
    c.onSubmit();
    const ids = service.createFromPurchaseOrder.calls.allArgs().map((a) => a[1].client_request_id);
    expect(ids.length).toBe(2);
    expect(ids[0]).toBe(ids[1]);
  });

  it('re-renders details.missing on a 422 INVOICING_SUPPORT_PO_001', () => {
    const f = setup(draftFixture());
    const c = f.componentInstance;
    service.createFromPurchaseOrder.and.returnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 422,
            error: {
              success: false,
              error_code: 'INVOICING_SUPPORT_PO_001',
              message: 'missing',
              details: {
                missing: [
                  missing('SUPPLIER_ADDRESS_REQUIRED', 'supplier', 'Falta la dirección del proveedor'),
                ],
              },
            },
          }),
      ),
    );

    c.onSubmit();
    f.detectChanges();

    expect(c.submitting()).toBeFalse();
    expect(text(f)).toContain('Falta la dirección del proveedor');
    expect(c.submitDisabled()).toBeTrue();
  });

  it('shows the active-document message on a 409 INVOICING_SUPPORT_PO_002', () => {
    const f = setup(draftFixture());
    const c = f.componentInstance;
    service.createFromPurchaseOrder.and.returnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: {
              success: false,
              error_code: 'INVOICING_SUPPORT_PO_002',
              message: 'active',
              details: { active_document: { id: 44, invoice_number: 'DS-44' } },
            },
          }),
      ),
    );

    c.onSubmit();
    f.detectChanges();

    expect(c.submitError()).toBe('Esta orden ya tiene el documento soporte N° DS-44 vigente.');
    expect(c.activeDocument()).toEqual({ id: 44, invoice_number: 'DS-44' });
    expect(c.submitDisabled()).toBeTrue();
  });

  it('generic mode (no purchase order) keeps loading suppliers and posting to the generic create', () => {
    const f = setup(null, null);
    const c = f.componentInstance;

    expect(service.getPurchaseOrderDraft).not.toHaveBeenCalled();
    expect(suppliers.getSuppliers).toHaveBeenCalled();
    expect(c.isPoMode()).toBeFalse();
    expect(text(f)).toContain('Tipo de documento');
    expect(text(f)).not.toContain('Forma de pago');

    c.form.patchValue({ supplier_id: 5 });
    c.addItem();
    c.itemsArray.at(0).patchValue({ description: 'Servicio', quantity: 1, unit_price: 1000 });
    c.onSubmit();

    expect(service.createFromPurchaseOrder).not.toHaveBeenCalled();
    expect(service.create).toHaveBeenCalledTimes(1);
    expect(service.create.calls.mostRecent().args[0].emit_immediately).toBeUndefined();
  });
});
