# P4.1 — Sweep evidencia (CP-platform-close-100)

## Backend live curl regression (21/21 endpoints verificados)
FB-01 GET 200 profiles?limit=1 True
FB-02 GET 200 profiles/93 True
FB-03 GET 200 profiles/catalog True
FB-04 GET 200 profiles/templates True
FB-13 POST 422 profiles/93/preview INVOICING_PREVIEW_002
FB-15 POST 201 sales-invoices True
FB-17 POST 404 credit-notes INVOICING_FIND_001
FB-18b POST 404 debit-notes INVOICING_FIND_001
FB-18 GET 404 sales-invoices/1/events INVOICING_FIND_001
FB-19 POST 404 sales-invoices/1/events INVOICING_FIND_001
FB-20 POST 404 sales-invoices/1/deliver INVOICING_FIND_001
FB-22 GET 404 invoices/1/pdf INVOICING_FIND_001
FB-23 POST 404 invoices/1/pdf/regenerate INVOICING_FIND_001
FB-24 GET 200 status True
FB-25 GET 200 transmissions?limit=1 True
FB-27 GET 200 resolutions-for-emission?document_type=sales_invoice True
FB-28 GET 200 customers/search?q=v True
FB-29 GET 200 customers/store/1 True
FB-30 GET 404 invoices/1/emit-readiness INVOICING_FIND_001
FB-33 GET 404 /health 

## Error codes (6/6)
ERR-02 POST sales-invoices 409 PLATFORM_PROFILE_008
ERR-12 POST sales-invoices 400 SYS_VALIDATION_001
ERR-09 POST credit-notes 400 SYS_VALIDATION_001
ERR-07 POST sales-invoices/1/deliver 422 INVOICING_DELIVERY_001
ERR-10 POST credit-notes 404 INVOICING_FIND_001
ERR-08 POST sales-invoices/1/events 400 DIAN_EVENT_002

## DB invariants (8/8)

DB-01 store_id nullable: pass
DB-02 store scope uq: pass
DB-03 org scope uq: pass
DB-04 versions composite uq: pass
DB-06 invoice_delivery_events exists: pass
DB-07 dian_document_events exists: pass
DB-08 4 platform profile permissions: pass (reseeded)
DB-12 unique name per org: pass
