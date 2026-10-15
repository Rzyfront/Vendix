import { FiscalInvoiceDataProvider } from './fiscal-invoice.provider';
import { PosElectronicInvoiceDataProvider } from './pos-electronic-invoice.provider';
import { InvoiceHolderLinkService } from '../../invoicing/invoice-holder-changes/invoice-holder-link.service';
import { StandardPrintDataModel } from '../interfaces/standard-print-data.model';
import { renderInvoiceHolderQr } from '../../invoicing/utils/invoice-holder-qr.util';
jest.mock('../../invoicing/utils/invoice-holder-qr.util', () => ({
  renderInvoiceHolderQr: jest.fn(async () => Buffer.from('holder-png')),
}));
describe.each([FiscalInvoiceDataProvider, PosElectronicInvoiceDataProvider])(
  'holder link provider %p',
  (Provider) => {
    it('adds a separate read-only holder payload without touching DIAN', async () => {
      const getLinkForInvoice = jest.fn(async () => ({
        token: 'cfh1.fixture',
        url: 'https://example.test/factura/cfh1.fixture',
        expires_at: new Date('2026-11-14T00:00:00Z'),
      }));
      const provider = new Provider({} as never, {} as never, undefined, {
        getLinkForInvoice,
      } as unknown as InvoiceHolderLinkService);
      const data = {
        fiscal: { qr_code_content: 'ORIGINAL-DIAN' },
      } as StandardPrintDataModel;
      await (
        provider as unknown as {
          attachHolderLink(
            data: StandardPrintDataModel,
            id: number,
            store: number,
          ): Promise<void>;
        }
      ).attachHolderLink(data, 10, 2);
      expect(getLinkForInvoice).toHaveBeenCalledWith(10, 2);
      expect(data.fiscal?.qr_code_content).toBe('ORIGINAL-DIAN');
      expect(data.holder_change?.url).toBe(
        'https://example.test/factura/cfh1.fixture',
      );
      expect(renderInvoiceHolderQr).toHaveBeenCalled();
    });
    it('does not invent a request or QR when eligibility returns null', async () => {
      const provider = new Provider({} as never, {} as never, undefined, {
        getLinkForInvoice: async () => null,
      } as unknown as InvoiceHolderLinkService);
      const data = {} as StandardPrintDataModel;
      await (
        provider as unknown as {
          attachHolderLink(
            data: StandardPrintDataModel,
            id: number,
            store: number,
          ): Promise<void>;
        }
      ).attachHolderLink(data, 10, 2);
      expect(data.holder_change).toBeUndefined();
    });
  },
);
