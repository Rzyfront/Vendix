import { allowsHolderChangeQr, stripAutomaticHolderQr } from '../holder-change-qr-policy';
import { normalizeDefinition } from '../../schemas/definition-normalizer';
import { validatePrintFormatDefinition } from '../../schemas/ajv-instance';
import { PrintGatewayService } from '../../services/print-gateway.service';
import { PrintFormatDefinition } from '../../interfaces/print-format.interface';
describe('POS holder QR store opt-in',()=>{
 it.each([undefined,false])('defaults missing/false (%s) to disabled',value=>expect(allowsHolderChangeQr('pos_electronic_invoice',{show_holder_change_qr:value})).toBe(false));
 it('accepts only true and leaves fiscal general unchanged',()=>{expect(allowsHolderChangeQr('pos_electronic_invoice',{show_holder_change_qr:true})).toBe(true);expect(allowsHolderChangeQr('fiscal_electronic_invoice',{})).toBe(true);});
 it.each([true,false])('normalizes legacy JSON without losing explicit boolean %s',value=>{
  const def=normalizeDefinition({paper:{format:'thermal_58'},sections:[],show_holder_change_qr:value}) as PrintFormatDefinition;
  expect(def.show_holder_change_qr).toBe(value);expect(validatePrintFormatDefinition(def).valid).toBe(true);
 });
 it('does not inject a true default and rejects textual flags',()=>{
  const def=normalizeDefinition({paper:{format:'thermal_58'},sections:[]}) as PrintFormatDefinition;
  expect(def.show_holder_change_qr).toBeUndefined();expect(validatePrintFormatDefinition({...def,show_holder_change_qr:'true'}).valid).toBe(false);
 });
 it('store false overrides a template true, and changes do not mutate base or another store',()=>{
  const gateway=Object.create(PrintGatewayService.prototype) as {mergeDefinition(base:PrintFormatDefinition,overrides:Record<string,unknown>):PrintFormatDefinition};
  const base: PrintFormatDefinition={paper:{format:'thermal_58',width_mm:58,is_roll:true,margin_mm:5,copies:1},sections:[],show_holder_change_qr:true};
  expect(gateway.mergeDefinition(base,{show_holder_change_qr:false}).show_holder_change_qr).toBe(false);
  expect(gateway.mergeDefinition(base,{show_holder_change_qr:true}).show_holder_change_qr).toBe(true);
  expect(base.show_holder_change_qr).toBe(true);
 });
 it('strips only the renderer-owned automatic block',()=>{
  expect(stripAutomaticHolderQr('<section data-vx-holder-change="cf-holder-v1">Auto</section><div>DIAN / manual</div>')).toBe('<div>DIAN / manual</div>');
 });
});
