import { Injectable } from '@nestjs/common';
import { user_state_enum } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { emailEquals, normalizeEmail } from '@common/utils/email.util';
import { ErrorCodes, VendixHttpException } from '../../../common/errors';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { CustomersService } from '../../store/customers/customers.service';
import { GuestBookingDto } from './dto/guest-booking.dto';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Resolves who owns a booking made without a session (switch
 * `ecommerce.checkout.allow_guest_booking`). The store ALWAYS comes from the
 * request's domain context: nothing the visitor sends can pick a store or a
 * customer.
 */
@Injectable()
export class GuestBookingService {
  constructor(
    private readonly globalPrisma: GlobalPrismaService,
    private readonly customersService: CustomersService,
  ) {}

  /**
   * Returns the customer id the booking is created for. Existing customer of
   * this store with that email → that customer, untouched (no data is read back
   * and no field of the account is overwritten by an anonymous caller);
   * otherwise a guest customer is created with the same helper the guest
   * checkout uses.
   */
  async resolveCustomerId(guest?: GuestBookingDto | null): Promise<number> {
    const storeId = RequestContextService.getContext()?.store_id;
    // Without a resolvable store the switch cannot be verified: fail closed.
    if (!storeId || !(await this.isAllowed(storeId))) {
      throw new VendixHttpException(ErrorCodes.STATION_BOOKING_013);
    }

    const name = guest?.name?.trim();
    const email = guest?.email?.trim();
    const phone = guest?.phone?.trim();
    if (!name || !email || !phone || !EMAIL_PATTERN.test(email)) {
      throw new VendixHttpException(ErrorCodes.STATION_BOOKING_014);
    }

    const existing = await this.globalPrisma.users.findFirst({
      where: {
        email: emailEquals(email),
        store_users: { some: { store_id: storeId } },
        user_roles: { some: { roles: { name: 'customer' } } },
        state: { not: user_state_enum.archived },
      },
      select: { id: true },
    });
    if (existing) return existing.id;

    const [firstName, ...rest] = name.split(/\s+/);
    // The phone is NOT handed to the helper: it also matches (and rewrites)
    // customers by phone, which would attach the booking to a stranger's account.
    const resolved = await this.customersService.resolveGuestCustomerForCheckout(
      storeId,
      {
        first_name: firstName,
        last_name: rest.join(' ') || null,
        email: normalizeEmail(email),
      },
    );
    if (!resolved) {
      throw new VendixHttpException(ErrorCodes.STATION_BOOKING_014);
    }
    if (resolved.was_created) {
      await this.globalPrisma.users.update({
        where: { id: resolved.customer_id },
        data: { phone: phone.replace(/\s+/g, '') },
      });
    }
    return resolved.customer_id;
  }

  private async isAllowed(storeId: number): Promise<boolean> {
    const row = await this.globalPrisma.store_settings.findFirst({
      where: { store_id: storeId },
      orderBy: { id: 'desc' },
      select: { settings: true },
    });
    const settings = (row?.settings as any) ?? {};
    return settings.ecommerce?.checkout?.allow_guest_booking === true;
  }
}
