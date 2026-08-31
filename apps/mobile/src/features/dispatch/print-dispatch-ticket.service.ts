/**
 * [print-editor-dsk P10] Mobile bridge for the dispatch-ticket print flow.
 *
 * The dispatch ticket (the small sheet that goes with the carrier so the
 * customer can sign on delivery) is rendered server-side by the print
 * gateway: only the backend knows the merchant's current paper choice,
 * template overrides and the fiscal/withholding lines that have to land
 * on the sheet. The mobile asks `/store/print-formats/render` to build the
 * HTML, then hands that exact HTML to `DocumentPrintService.printHtml`
 * which sizes it for expo-print.
 *
 * Kept as its own thin service — instead of being inlined in the dispatch
 * screen — so the same `renderDocument → printHtml` pair can be reused by
 * the carrier mobile flow when the driver needs to reprint the ticket at
 * the customer's door.
 */
import { DocumentPrintService } from '@/shared/print';

export const DispatchTicketPrintService = {
  /**
   * Renders the dispatch ticket for `orderId` against the merchant's
   * current print configuration and opens the OS print dialog. Returns the
   * same HTML the backend produced so a screen that wants to log or share
   * it has something to work with.
   */
  async printDispatchTicket(orderId: number | string): Promise<string> {
    const result = await DocumentPrintService.renderDocument({
      formatType: 'dispatch_ticket',
      documentId: orderId,
      engine: 'html',
    });
    await DocumentPrintService.printHtml(result.html, {
      widthMm: result.width_mm,
      isRoll: result.is_roll,
      copies: result.copies,
    });
    return result.html;
  },
};

export type DispatchTicketPrintServiceType = typeof DispatchTicketPrintService;