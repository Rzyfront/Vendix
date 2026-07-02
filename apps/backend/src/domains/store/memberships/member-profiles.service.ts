import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { UpsertMemberProfileDto } from './dto';

/**
 * MemberProfilesService
 *
 * Store-scoped upsert/read for member profiles (`membership_profiles`), unique
 * per (store, customer). Holds emergency contact, medical notes, goals and
 * physical metrics — never a raw biometric template.
 *
 * Uses `withoutScope()` + explicit `store_id` (see MembershipsService note)
 * and performs the upsert as scope-safe read/create/update steps (the scoped
 * unique-operation caveat does not apply to the base client, but we still
 * keep the tenant predicate explicit).
 */
@Injectable()
export class MemberProfilesService {
  constructor(private readonly prisma: StorePrismaService) {}

  private requireStoreId(): number {
    const storeId = RequestContextService.getContext()?.store_id;
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    return storeId;
  }

  private get profiles() {
    return this.prisma.withoutScope().membership_profiles;
  }

  async getByCustomer(customerId: number) {
    const storeId = this.requireStoreId();
    const profile = await this.profiles.findFirst({
      where: { store_id: storeId, customer_id: customerId },
    });
    if (!profile) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        'Perfil del socio no encontrado',
      );
    }
    return profile;
  }

  async upsert(customerId: number, dto: UpsertMemberProfileDto) {
    const storeId = this.requireStoreId();

    // Customer must exist.
    const customer = await this.prisma.users.findFirst({
      where: { id: customerId },
      select: { id: true },
    });
    if (!customer) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        'El cliente (socio) no existe',
      );
    }

    const fields = {
      date_of_birth: dto.date_of_birth ? new Date(dto.date_of_birth) : undefined,
      gender: dto.gender,
      emergency_contact_name: dto.emergency_contact_name,
      emergency_contact_phone: dto.emergency_contact_phone,
      medical_notes: dto.medical_notes,
      goals: dto.goals,
      height_cm: dto.height_cm,
      weight_kg:
        dto.weight_kg !== undefined ? new Prisma.Decimal(dto.weight_kg) : undefined,
    };

    const existing = await this.profiles.findFirst({
      where: { store_id: storeId, customer_id: customerId },
      select: { id: true },
    });

    if (existing) {
      await this.profiles.updateMany({
        where: { id: existing.id, store_id: storeId },
        data: fields,
      });
      return this.getByCustomer(customerId);
    }

    return this.profiles.create({
      data: {
        store_id: storeId,
        customer_id: customerId,
        ...fields,
      },
    });
  }
}
