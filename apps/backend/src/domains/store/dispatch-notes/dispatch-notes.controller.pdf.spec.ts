import { NotFoundException } from '@nestjs/common';
import { DispatchNotesController } from './dispatch-notes.controller';

/**
 * ADR-15 §4 (CP-pos-exclusive-tax-double-charge, unificación
 * remisión-gateway) — `POST /store/dispatch-notes/:id/pdf` deja de llamar a
 * `DispatchNotePdfService` directo y pide el motor `pdf` del formato
 * `dispatch_note` a `PrintGatewayService`. El contrato HTTP hacia el cliente
 * (headers, status, nombre de archivo) no puede cambiar: sigue siendo el
 * mismo PDF, sólo cambia el transporte interno.
 *
 * El `storeId` sale de la REMISIÓN, no del `RequestContext`. Dos motivos, y
 * los dos serían regresiones respecto al riel viejo:
 *   · en alcance ORGANIZACIÓN el contexto corre con `store_id: null`
 *     (`tenant-context-runner.service.ts`), así que exigirlo devolvería un
 *     403 nuevo a quien hoy imprime sin problema;
 *   · con contexto de tienda A, imprimir la remisión de la tienda B habría
 *     resuelto el formato de A — papel con el diseño de otro.
 */
describe('DispatchNotesController — POST :id/pdf (unificación remisión-gateway)', () => {
  function buildRes() {
    return {
      set: jest.fn(),
      end: jest.fn(),
    } as unknown as import('express').Response;
  }

  function buildController(
    renderDocument: jest.Mock,
    resolveStoreIdForPrint: jest.Mock,
  ) {
    const printGatewayService = { renderDocument } as any;
    const dispatchNotesService = { resolveStoreIdForPrint } as any;
    const controller = new DispatchNotesController(
      dispatchNotesService,
      {} as any, // dispatchNoteFlowService — no lo usa este endpoint
      printGatewayService,
      {} as any, // responseService — no lo usa este endpoint (usa `res` directo)
    );
    return { controller, printGatewayService, dispatchNotesService };
  }

  it('pide engine pdf para dispatch_note con el storeId de la REMISIÓN y responde con las mismas cabeceras', async () => {
    const pdf = Buffer.from('%PDF-1.4 remision-220');
    const renderDocument = jest.fn().mockResolvedValue({
      format_type: 'dispatch_note',
      pdf_buffer: pdf,
      copies: 2,
      is_roll: false,
      width_mm: 210,
    });
    const resolveStoreIdForPrint = jest.fn().mockResolvedValue(63);
    const { controller } = buildController(
      renderDocument,
      resolveStoreIdForPrint,
    );
    const res = buildRes();

    await controller.generatePdf(220, res);

    expect(resolveStoreIdForPrint).toHaveBeenCalledWith(220);
    expect(renderDocument).toHaveBeenCalledWith(63, 'dispatch_note', 220, 'pdf');
    expect(res.set).toHaveBeenCalledWith({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="remision-220.pdf"',
      'Content-Length': pdf.length.toString(),
    });
    expect(res.end).toHaveBeenCalledWith(pdf);
  });

  it('el formato es el de la tienda EMISORA, no el de la tienda del contexto', async () => {
    // El riel viejo no miraba el contexto para nada. Si el `storeId` saliera
    // de ahí, un administrador de organización parado en la tienda 7 vería la
    // remisión de la tienda 63 impresa con el formato de la 7.
    const renderDocument = jest
      .fn()
      .mockResolvedValue({ pdf_buffer: Buffer.from('x') });
    const resolveStoreIdForPrint = jest.fn().mockResolvedValue(63);
    const { controller } = buildController(
      renderDocument,
      resolveStoreIdForPrint,
    );

    await controller.generatePdf(220, buildRes());

    expect(renderDocument.mock.calls[0][0]).toBe(63);
  });

  it('una remisión que el alcance del usuario no alcanza rechaza ANTES de llamar al gateway', async () => {
    const renderDocument = jest.fn();
    const resolveStoreIdForPrint = jest
      .fn()
      .mockRejectedValue(new NotFoundException('Remisión no encontrada'));
    const { controller } = buildController(
      renderDocument,
      resolveStoreIdForPrint,
    );
    const res = buildRes();

    await expect(controller.generatePdf(220, res)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    expect(renderDocument).not.toHaveBeenCalled();
    expect(res.set).not.toHaveBeenCalled();
  });
});
