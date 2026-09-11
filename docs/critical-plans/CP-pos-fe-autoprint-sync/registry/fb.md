# Frontend↔Backend Contract Registry
| Id | Method + route | Request DTO | Response shape | Frontend consumer | Change | Risk | Verification | Status |
|----|----------------|-------------|----------------|-------------------|--------|------|--------------|--------|
| FB-01 | GET /store/invoicing/pos/orders/:orderId/fiscal-status | none (orderId in URL) | ResponseDto<PosFiscalStatus> | PosFiscalService.getFiscalStatus | none (regression check only) | Incompatibilidad de estados fiscales | curl -s "http://localhost:3000/store/invoicing/pos/orders/1/fiscal-status" | [x] |
| FB-02 | POST /store/invoicing/pos/orders/:orderId/emit | none | ResponseDto<PosFiscalStatus> | PosFiscalService.emit | none (regression check only) | Re-emisión accidental con consecutivo duplicado | curl -X POST -s "http://localhost:3000/store/invoicing/pos/orders/1/emit" | [x] |
| FB-03 | POST /store/print-formats/resolve-for-document | ResolvePrintDocumentDto | ResponseDto<ResolvedPrintDocumentDto> | DocumentPrintService.resolveAndPrint | none (regression check only) | Formato incorrecto devuelto por gate | curl -X POST -d '{"document_type":"pos_order","document_id":1}' ".../resolve-for-document" | [x] |
