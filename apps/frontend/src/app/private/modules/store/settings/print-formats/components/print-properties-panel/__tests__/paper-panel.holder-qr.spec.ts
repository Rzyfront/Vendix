import { TestBed } from '@angular/core/testing';
import { PrintPaperPanelComponent } from '../paper-panel.component';
import { DocumentPrintService } from '../../../../../../../../shared/services/print/document-print.service';
import { PrintFormatDefinition } from '../../../../../../../../core/models/print-formats.model';
describe('POS holder QR opt-in checkbox',()=>{
 const definition:PrintFormatDefinition={paper:{format:'thermal_58',width_mm:58,is_roll:true,margin_mm:5,copies:1},sections:[]};
 beforeEach(()=>TestBed.configureTestingModule({imports:[PrintPaperPanelComponent],providers:[{provide:DocumentPrintService,useValue:{}}]}));
 it('shows POS-only unchecked default and emits full definition for existing store save circuit',()=>{
  const f=TestBed.createComponent(PrintPaperPanelComponent);f.componentRef.setInput('definition',definition);f.componentRef.setInput('formatType','pos_electronic_invoice');f.detectChanges();
  const checkbox=f.nativeElement.querySelector('#print-format-holder-change-qr') as HTMLInputElement;
  expect(checkbox).not.toBeNull();expect(checkbox.checked).toBeFalse();expect(f.nativeElement.textContent).toContain('Solo en facturas de consumidor final. Desactivado por defecto.');
  const emit=spyOn(f.componentInstance.definitionChanged,'emit');f.componentInstance.setHolderChangeQr(true);expect(emit).toHaveBeenCalledWith({...definition,show_holder_change_qr:true});f.componentInstance.setHolderChangeQr(false);expect(emit).toHaveBeenCalledWith({...definition,show_holder_change_qr:false});expect(definition.show_holder_change_qr).toBeUndefined();f.destroy();
 });
 it('does not offer or mutate the setting on fiscal general',()=>{
  const f=TestBed.createComponent(PrintPaperPanelComponent);f.componentRef.setInput('definition',definition);f.componentRef.setInput('formatType','fiscal_electronic_invoice');f.detectChanges();expect(f.nativeElement.querySelector('#print-format-holder-change-qr')).toBeNull();const emit=spyOn(f.componentInstance.definitionChanged,'emit');f.componentInstance.setHolderChangeQr(true);expect(emit).not.toHaveBeenCalled();f.destroy();
 });
});
