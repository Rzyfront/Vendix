import { Injectable, Logger } from '@nestjs/common';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { computeNitDv, normalizeNit } from '@common/utils/nit.util';
import { PLATFORM_FISCAL_SETTINGS_KEY } from '@common/constants/platform-fiscal.constants';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import { tryResolveTenantFiscalIdentity } from '@common/helpers/fiscal-identity.helper';
import { BillingProfileDto } from '../dto/billing-profile.dto';
import {
  AcquirerAddressCandidate,
  DianAcquirerAddressSource,
  classifyAcquirerAddressType,
  resolveAcquirerAddress,
} from '../../invoicing/providers/dian-direct/acquirer-address.resolver';

/**
 * Fila de `addresses` tal como `get()` la lee para precargar el checkout.
 *
 * `type` viaja porque es lo ÚNICO que separa el primer escalón de la cascada
 * (dirección fiscal) del segundo (cualquier otra de la organización); se
 * descarta antes de devolver la dirección, igual que hace la emisión.
 */
interface BillingProfileAddressRow {
  address_line1: string;
  address_line2: string | null;
  city: string;
  state_province: string | null;
  country_code: string;
  postal_code: string | null;
  municipality_code: string | null;
  type: string;
}

/** La dirección que el perfil devuelve, sin el metadato de la cascada. */
type BillingProfileAddress = Omit<BillingProfileAddressRow, 'type'>;

/** Dirección elegida por la cascada más el escalón del que salió. */
interface ResolvedBillingProfileAddress {
  address: BillingProfileAddress;
  source: DianAcquirerAddressSource;
}

/**
 * Candidato de la cascada que además recuerda de qué fila salió.
 *
 * El resolvedor sólo conserva los campos que viajan al XML, y el formulario del
 * checkout necesita también `address_line2`. Cargar el índice permite devolver
 * la fila ENTERA sin volver a adivinar cuál ganó comparando textos.
 */
interface IndexedAcquirerAddressCandidate extends AcquirerAddressCandidate {
  row_index: number;
}

/** Cuántas direcciones de la organización entran a la cascada. */
const BILLING_ADDRESS_CANDIDATE_LIMIT = 10;

/**
 * Persists the fiscal identity of the organization that pays for a subscription.
 *
 * Vendix invoices its own subscriptions electronically, which makes the paying
 * organization the *adquiriente* of a DIAN invoice. Checkout is the only moment
 * where that data can be asked for while the customer is present and motivated;
 * afterwards it becomes a support ticket. So the profile is captured here and
 * stored on the organization, not on the invoice: it is a property of the
 * client, and every future invoice needs it.
 *
 * The write is idempotent — committing the same profile twice produces the same
 * rows — because a checkout can legitimately be retried after a payment error.
 */
@Injectable()
export class SubscriptionBillingProfileService {
  private readonly logger = new Logger(SubscriptionBillingProfileService.name);

  constructor(private readonly prisma: GlobalPrismaService) {}

  /**
   * Upserts the organization's fiscal identity and its `billing` address.
   *
   * `verification_digit` is derived, never taken from the caller: it is a
   * modulo-11 checksum of the NIT, so a value typed by a human can only agree
   * with the NIT or be wrong.
   */
  async save(
    organizationId: number,
    profile: BillingProfileDto,
  ): Promise<void> {
    const taxId = profile.tax_id;
    const documentType = profile.document_type;
    // Only a NIT carries a DV. For CC/CE/passport the field stays null rather
    // than holding a checksum of something that is not a NIT.
    const verificationDigit =
      documentType === '31' ? computeNitDv(taxId) || null : null;

    await this.prisma.withoutScope().$transaction(async (tx) => {
      await tx.organizations.update({
        where: { id: organizationId },
        data: {
          legal_name: profile.legal_name,
          tax_id: taxId,
          document_type: documentType,
          verification_digit: verificationDigit,
          person_type:
            profile.person_type ?? (documentType === '31' ? '1' : '2'),
          tax_regime: profile.tax_regime ?? '49',
          fiscal_responsibilities: profile.fiscal_responsibilities ?? [],
          ...(profile.email ? { email: profile.email } : {}),
        },
      });

      const address = profile.address;
      const addressData = {
        address_line1: address.address_line1,
        address_line2: address.address_line2 ?? null,
        city: address.city,
        state_province: address.state_province ?? null,
        municipality_code: address.municipality_code,
        country_code: address.country_code ?? 'CO',
        postal_code: address.postal_code ?? null,
        type: 'billing' as const,
        is_primary: true,
      };

      // `addresses` has no unique key on (organization_id, type), so the upsert
      // is done by hand: reuse the existing billing row when there is one so the
      // FKs that already point at it keep resolving.
      const existing = await tx.addresses.findFirst({
        where: { organization_id: organizationId, type: 'billing' },
        orderBy: [{ is_primary: 'desc' }, { id: 'asc' }],
        select: { id: true },
      });

      if (existing) {
        await tx.addresses.update({
          where: { id: existing.id },
          data: addressData,
        });
      } else {
        await tx.addresses.create({
          data: { ...addressData, organization_id: organizationId },
        });
      }
    });

    this.logger.log(
      `Billing profile saved for organization=${organizationId} document_type=${documentType}`,
    );
  }

  /**
   * True only when Vendix is really emitting electronic invoices for its own
   * subscriptions: the platform switch is on AND it points at production.
   *
   * This is the master gate for the whole billing-profile flow. While the
   * platform is unconfigured — or still inside DIAN habilitación, where every
   * document is a test artefact — asking a customer for their NIT, DANE code
   * and fiscal responsibilities collects data no document will carry, and
   * blocking a payment over it would be indefensible.
   */
  async platformInvoicingLive(): Promise<boolean> {
    const row = await this.prisma.withoutScope().platform_settings.findUnique({
      where: { key: PLATFORM_FISCAL_SETTINGS_KEY },
      select: { value: true },
    });
    const value = (row?.value ?? {}) as {
      is_enabled?: boolean;
      environment?: string;
    };
    return value.is_enabled === true && value.environment === 'production';
  }

  /**
   * True when the customer already runs its own electronic invoicing.
   *
   * The same fiscal identity that Vendix uses as *adquiriente* is what the
   * customer's fiscal module uses as *emisor*. Once that module is live, the
   * identity is master data owned by it — letting a checkout screen rewrite the
   * NIT or the razón social would silently change the emitter of documents the
   * DIAN has already accepted.
   *
   * Read as "active anywhere in the organization" rather than through
   * `FiscalGateService`: the gate needs a `store_id` when `fiscal_scope=STORE`
   * and fails closed to `false` without one, which would report "editable" for
   * an organization whose stores are invoicing. A lock that fails open is not a
   * lock. Two indexed JSON-path probes cost less than resolving the scope.
   */
  async fiscalModuleActive(organizationId: number): Promise<boolean> {
    const client = this.prisma.withoutScope();
    const activeStates = ['ACTIVE', 'LOCKED'].map((state) => ({
      settings: {
        path: ['fiscal_status', 'invoicing', 'state'],
        equals: state,
      },
    }));

    const org = await client.organization_settings.findFirst({
      where: { organization_id: organizationId, OR: activeStates },
      select: { id: true },
    });
    if (org) return true;

    const store = await client.store_settings.findFirst({
      where: { stores: { organization_id: organizationId }, OR: activeStates },
      select: { id: true },
    });
    return !!store;
  }

  /**
   * Current profile plus whether it is complete, so the checkout form can
   * prefill known values and only demand what is genuinely missing.
   *
   * `locked` says the data is on file AND owned by the customer's fiscal
   * module, so checkout must render it read-only. It is deliberately
   * `active && complete`: an organization whose module is live but whose
   * profile is still missing a field would otherwise be unable to pay and
   * unable to fix it from here.
   */
  async get(organizationId: number) {
    const org = await this.prisma.withoutScope().organizations.findUnique({
      where: { id: organizationId },
      select: {
        legal_name: true,
        tax_id: true,
        email: true,
        document_type: true,
        verification_digit: true,
        name: true,
        person_type: true,
        tax_regime: true,
        fiscal_responsibilities: true,
        organization_settings: { select: { settings: true } },
        // SIN filtro por `type`: quién decide cuál dirección es la fiscal es la
        // cascada de abajo, no la consulta. Filtrando `billing` acá, una
        // organización que configuró su domicilio en el onboarding o en ajustes
        // con otro tipo veía «Dirección» vacía en el checkout y la volvía a
        // teclear — que es exactamente cómo entra un dato peor que el que ya
        // estaba en la base.
        addresses: {
          orderBy: [{ is_primary: 'desc' }, { id: 'asc' }],
          take: BILLING_ADDRESS_CANDIDATE_LIMIT,
          select: {
            address_line1: true,
            address_line2: true,
            city: true,
            state_province: true,
            country_code: true,
            postal_code: true,
            municipality_code: true,
            type: true,
          },
        },
      },
    });

    const [enabled, complete, fiscalActive] = await Promise.all([
      this.platformInvoicingLive(),
      this.isComplete(organizationId),
      this.fiscalModuleActive(organizationId),
    ]);

    const orgFiscalData = ((org?.organization_settings as any)?.settings
      ?.fiscal_data ?? null) as Record<string, unknown> | null;

    // NIT y razón social resueltos por el resolvedor único — la ÚNICA fuente —
    // en su variante PERMISIVA. Esta es una superficie de LECTURA/EDICIÓN: el
    // cliente abre la sección fiscal del checkout justamente para completar lo
    // que le falta. Con el resolvedor estricto, `get()` lanzaba
    // «No hay municipio DIAN para el NIT …» y la sección quedaba inaccesible
    // para los tenants que más necesitan llenarla. La emisión sigue usando el
    // resolvedor estricto; ver la nota de asimetría lectura/emisión en
    // `fiscal-identity.helper.ts`.
    const { identity } = tryResolveTenantFiscalIdentity({
      nit: org?.tax_id ?? '',
      fiscal_data: orgFiscalData,
      organization: org
        ? { legal_name: org.legal_name, name: org.name }
        : null,
    });

    // Misma cascada que usa la emisión para el adquiriente: fiscal → cualquier
    // otra → nada. Precargar lo que la organización YA tiene es lo que evita
    // que el checkout pida de nuevo un dato que existe.
    const resolvedAddress = this.resolveProfileAddress(
      (org?.addresses ?? []) as BillingProfileAddressRow[],
    );

    return {
      // `enabled: false` means the checkout must not render the fiscal section
      // at all — not that the data is missing.
      enabled,
      complete,
      locked: complete && fiscalActive,
      profile: org
        ? {
            legal_name: identity.legal_name,
            tax_id: identity.nit || null,
            email: org.email,
            document_type: org.document_type,
            verification_digit: identity.nit_dv || null,
            person_type: org.person_type,
            // `tax_regime` y `fiscal_responsibilities` se leen del JSON
            // (fiscal_data) — el plan los declara proyección derivada y
            // nunca lectura de columna.
            tax_regime:
              (orgFiscalData?.['tax_regime'] as string) ?? null,
            fiscal_responsibilities: Array.isArray(
              orgFiscalData?.['tax_responsibilities'],
            )
              ? (orgFiscalData?.['tax_responsibilities'] as string[])
              : org.fiscal_responsibilities,
            address: resolvedAddress?.address ?? null,
            // De qué escalón salió la dirección. Un respaldo que se anuncia es
            // una decisión; uno silencioso es una suposición disfrazada de
            // dato — es la misma razón por la que la emisión lo reporta.
            address_source: resolvedAddress?.source ?? null,
          }
        : null,
    };
  }

  /**
   * Dirección con la que el checkout precarga el formulario, elegida por la
   * MISMA cascada que usa la emisión (`resolveAcquirerAddress`): direcciones
   * fiscales (`billing` / `legal`) primero, cualquier otra de la organización
   * después.
   *
   * ## Por qué hay un respaldo después de la cascada
   *
   * `resolveAcquirerAddress` descarta todo candidato que no sea EMITIBLE —
   * una dirección colombiana sin municipio DANE no pasa `canEmitAddress`. Eso
   * es correcto para emitir y sería contraproducente acá: el tenant abre esta
   * pantalla justamente para completar lo que le falta, y devolverle `null`
   * porque su dirección aún no tiene código DANE le dejaría el campo vacío y le
   * haría teclear de nuevo la calle que ya tenía guardada.
   *
   * Así que cuando la cascada no encuentra nada emitible, se devuelve la mejor
   * fila EN CRUDO ordenada por el mismo criterio (`classifyAcquirerAddressType`,
   * el mismo que usa la cascada) y el municipio se lo pone el selector DANE del
   * formulario. Es la misma asimetría lectura/emisión que ya rige el resolvedor
   * de identidad fiscal unas líneas más arriba: leer es permisivo, emitir es
   * estricto.
   */
  private resolveProfileAddress(
    rows: BillingProfileAddressRow[],
  ): ResolvedBillingProfileAddress | null {
    if (!rows.length) return null;

    const candidates: IndexedAcquirerAddressCandidate[] = rows.map(
      (row, index) => ({
        row_index: index,
        type: row.type,
        address_line: row.address_line1,
        city_code: row.municipality_code ?? undefined,
        city_name: row.city,
        // El departamento se deriva del municipio, que es su prefijo Divipola.
        // Sin esto la cascada tendría que resolverlo por nombre y una fila con
        // código bueno y departamento mal escrito quedaría descartada.
        department_code: row.municipality_code
          ? row.municipality_code.slice(0, 2)
          : undefined,
        department_name: row.state_province ?? undefined,
        country_code: row.country_code,
        postal_code: row.postal_code ?? undefined,
      }),
    );

    const resolved = resolveAcquirerAddress({
      candidates,
      // El emisor de esta factura es Vendix, no el tenant: su domicilio jamás
      // puede ser el respaldo de la dirección del tenant. El tercer escalón de
      // la cascada se deja deliberadamente vacío.
      store_address: null,
    });

    if (resolved) {
      const index = (resolved.address as IndexedAcquirerAddressCandidate)
        .row_index;
      const row = typeof index === 'number' ? rows[index] : undefined;
      if (row) {
        return { address: this.stripRowType(row), source: resolved.source };
      }
    }

    const fallback =
      rows.find((row) => classifyAcquirerAddressType(row.type) === 'fiscal') ??
      rows[0];
    return {
      address: this.stripRowType(fallback),
      source: classifyAcquirerAddressType(fallback.type),
    };
  }

  /** Quita el `type`, que es metadato de la cascada y no de la dirección. */
  private stripRowType(row: BillingProfileAddressRow): BillingProfileAddress {
    const { type: _type, ...address } = row;
    return address;
  }

  /**
   * Checkout entry point. Saves the profile when the client sent one; when it
   * did not, demands one only if the commit will actually charge AND the
   * organization does not already have a complete profile.
   *
   * Requiring it on every commit would break renewals and free-plan swaps for
   * organizations whose data has been on file for months; requiring it on none
   * is how the platform ended up with 87% of organizations lacking a NIT.
   */
  async ensureCaptured(
    organizationId: number,
    profile: BillingProfileDto | undefined,
    opts: { required: boolean },
  ): Promise<void> {
    // Master gate: with the platform not emitting real invoices there is no
    // fiscal data to demand and nothing to save. A checkout must never fail
    // over paperwork for a document that will not exist.
    if (!(await this.platformInvoicingLive())) return;

    const complete = await this.isComplete(organizationId);

    // The fiscal module owns the identity once it is live. Checkout hides the
    // edit affordance in that case, but the hiding is cosmetic — a crafted
    // request would still reach here, so the write is dropped server-side.
    // Dropped, not rejected: the client legitimately echoes back the prefilled
    // values, and failing a payment over a no-op write helps nobody.
    if (complete && (await this.fiscalModuleActive(organizationId))) {
      if (profile) {
        this.logger.warn(
          `Billing profile edit ignored for organization=${organizationId}: ` +
            'fiscal module is active and owns the fiscal identity',
        );
      }
      return;
    }

    if (profile) {
      await this.save(organizationId, profile);
      return;
    }
    if (!opts.required) return;
    if (complete) return;

    throw new VendixHttpException(
      ErrorCodes.SUBSCRIPTION_FISCAL_001,
      'Necesitamos los datos de facturación de tu empresa para emitir la factura electrónica de esta suscripción.',
      { organization_id: organizationId, field: 'billing_profile' },
    );
  }

  /**
   * True when the organization already holds everything DIAN needs from the
   * acquirer, so checkout can skip asking again on a renewal or plan change.
   *
   * Mirrors `SubscriptionFiscalService.missingCustomerFiscalData` — the two must
   * agree, otherwise checkout accepts a profile the emitter later refuses.
   */
  async isComplete(organizationId: number): Promise<boolean> {
    const org = await this.prisma.withoutScope().organizations.findUnique({
      where: { id: organizationId },
      select: {
        legal_name: true,
        email: true,
        name: true,
        organization_settings: { select: { settings: true } },
        // Sin filtro por `type`: la misma cascada que usa el emisor. Filtrar por
        // `billing` dejaba a este gate MÁS estricto que la emisión, así que una
        // organización cuya única dirección fiscal es `legal` quedaba marcada
        // como incompleta y el checkout le pedía de nuevo un dato que ya tiene
        // y con el que la factura sale perfectamente.
        addresses: {
          orderBy: [{ is_primary: 'desc' }, { id: 'asc' }],
          take: BILLING_ADDRESS_CANDIDATE_LIMIT,
          select: {
            address_line1: true,
            address_line2: true,
            city: true,
            state_province: true,
            country_code: true,
            postal_code: true,
            municipality_code: true,
            type: true,
          },
        },
      },
    });
    if (!org) return false;

    // Validación de NIT desde el JSON, no la columna. Si `fiscal_data.nit`
    // falta o no parsea, el perfil está incompleto — sin caer a `org.tax_id`
    // (que podría estar rancio o vacío por el defecto histórico que cerró
    // el plan de SSOT).
    const fiscalDataNit = (org?.organization_settings as any)?.settings
      ?.fiscal_data?.nit as string | undefined;
    const { number, dv } = normalizeNit(fiscalDataNit ?? '');
    if (!number) return false;
    if (!dv) return false; // el DV se deriva del NIT, no se lee de columna

    if (!org.legal_name?.trim() || !org.email?.trim()) return false;

    // Cascada ESTRICTA, la misma de la emisión (`resolveAcquirerAddress` filtra
    // por `canEmitAddress`, así que una dirección colombiana sin municipio DANE
    // queda descartada). Aquí no se usa el respaldo permisivo de
    // `resolveProfileAddress`: ese existe para PRECARGAR el formulario, y
    // aceptarlo como «completo» dejaría pasar en el checkout una dirección que
    // el emisor luego rechaza — justo la divergencia que este espejo evita.
    return (
      resolveAcquirerAddress({
        candidates: (org.addresses ?? []) as AcquirerAddressCandidate[],
        store_address: null,
      }) !== null
    );
  }
}
