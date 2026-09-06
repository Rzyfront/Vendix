# Critical Files

- `apps/backend/src/domains/store/quotations/quotations.service.ts` — estados y convertToOrder (no tocar, solo gates)
- `apps/backend/src/domains/store/quotations/dto/create-quotation.dto.ts` — suma destination + profile_id
- `apps/backend/src/domains/store/quotations/dto/update-quotation.dto.ts` — prohibe editar destination
- `apps/backend/src/domains/store/invoicing/profiles/profiles.service.ts` — patron a espejar en perfiles de cotizacion
- `apps/backend/src/domains/store/invoicing/profiles/invoice-profile-config.contract.ts` — patron de snapshot versionado
- `apps/backend/src/domains/store/invoicing/invoicing.service.ts` — createFromOrder como patron de precarga
- `apps/backend/prisma/schema.prisma` — quotations, perfiles, contracts, invoices.contract_id
- `apps/frontend/src/app/shared/constants/industry-modules.constant.ts` — gating construction existente
- `apps/frontend/src/app/private/modules/store/quotations/` — formulario, detalle y servicios a extender
- `apps/frontend/src/app/private/modules/store/invoicing/` — paginas de perfiles y factura AIU como referencia
