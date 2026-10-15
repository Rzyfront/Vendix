import { PrintFormatsService } from './print-formats.service';
import { FormatAdapterRegistryService } from './format-adapter-registry.service';
import { PrintGatewayService } from './print-gateway.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { PrintFiscalValidatorService } from './print-fiscal-validator.service';
import { OrganizationPrismaService } from '../../../../prisma/services/organization-prisma.service';
import { DocumentDataProviderRegistry } from '../providers/document-data-provider.registry';
describe('POS holder QR opt-in persistence',()=>{
 it('saves true/false only in the selected store format overrides without a backfill',async()=>{
  const configs={findFirst:jest.fn(async()=>({id:7,is_active:true,gateway_enabled:true,template_id:null,overrides:null})),update:jest.fn(async({data})=>({id:7,...data})),create:jest.fn()};
  const definition={v:2,paper:{format:'thermal_58'},sections:[]};
  const gateway={resolveEffectiveConfig:jest.fn(async()=>({definition}))};
  const service=new PrintFormatsService({store_print_format_configs:configs} as unknown as StorePrismaService,{} as OrganizationPrismaService,gateway as unknown as PrintGatewayService,{assertSaveCompliance:jest.fn()} as unknown as PrintFiscalValidatorService,{getProvider:()=>({getAvailableTokens:()=>[]})} as unknown as DocumentDataProviderRegistry,new FormatAdapterRegistryService());
  for(const value of [true,false]){
    await service.updateStoreFormat(10,3,'pos_electronic_invoice',{overrides:{...definition,show_holder_change_qr:value}});
    expect(configs.findFirst).toHaveBeenCalledWith(expect.objectContaining({where:{store_id:10,format_type:'pos_electronic_invoice'}}));
    expect(configs.update).toHaveBeenLastCalledWith(expect.objectContaining({where:{id:7},data:expect.objectContaining({overrides:expect.objectContaining({show_holder_change_qr:value})})}));
  }
  expect(configs.create).not.toHaveBeenCalled();expect(configs.update).toHaveBeenCalledTimes(2);
 });
});
