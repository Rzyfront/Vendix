import { Injectable, Logger } from '@nestjs/common';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { computeNitDv, normalizeNit } from '@common/utils/nit.util';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import { BillingProfileDto } from '../dto/billing-profile.dto';

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
   * Current profile plus whether it is complete, so the checkout form can
   * prefill known values and only demand what is genuinely missing.
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
        person_type: true,
        tax_regime: true,
        fiscal_responsibilities: true,
        addresses: {
          where: { type: 'billing' },
          orderBy: [{ is_primary: 'desc' }, { id: 'asc' }],
          take: 1,
          select: {
            address_line1: true,
            address_line2: true,
            city: true,
            state_province: true,
            country_code: true,
            postal_code: true,
            municipality_code: true,
          },
        },
      },
    });

    return {
      complete: await this.isComplete(organizationId),
      profile: org
        ? {
            legal_name: org.legal_name,
            tax_id: org.tax_id,
            email: org.email,
            document_type: org.document_type,
            verification_digit: org.verification_digit,
            person_type: org.person_type,
            tax_regime: org.tax_regime,
            fiscal_responsibilities: org.fiscal_responsibilities,
            address: org.addresses[0] ?? null,
          }
        : null,
    };
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
    if (profile) {
      await this.save(organizationId, profile);
      return;
    }
    if (!opts.required) return;
    if (await this.isComplete(organizationId)) return;

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
        tax_id: true,
        email: true,
        document_type: true,
        verification_digit: true,
        addresses: {
          where: { type: 'billing' },
          orderBy: [{ is_primary: 'desc' }, { id: 'asc' }],
          take: 1,
          select: { municipality_code: true },
        },
      },
    });
    if (!org) return false;

    // The NIT is often stored with the DV inline (`800987654-3`). The DV is
    // derived from the number, so it is never "missing" for a valid NIT — the
    // check is really that the number itself parses.
    const { number, dv } = normalizeNit(org.tax_id);
    const documentType = org.document_type ?? (org.tax_id ? '31' : null);
    if (documentType === '31' && !dv) return false;

    return !!(
      number &&
      org.legal_name?.trim() &&
      org.email?.trim() &&
      org.addresses[0]?.municipality_code
    );
  }
}
