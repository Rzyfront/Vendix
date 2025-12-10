import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';

@Injectable()
export class StoreUsersService {
  constructor(private prisma: StorePrismaService) {}

  async create(data: any) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    if (!store_id) {
      throw new ForbiddenException('Store context required');
    }

    // Ensure store_id is set
    return this.prisma.store_users.create({
      data: {
        ...data,
        store_id: store_id,
      },
    });
  }

  async findAll() {
    // Auto-scoped
    const storeUsers = await this.prisma.store_users.findMany({
      include: {
        user: true,
        store: true,
      },
    });

    // Transform to match frontend expectations
    return storeUsers.map((storeUser) => ({
      id: storeUser.user.id,
      username: storeUser.user.username,
      email: storeUser.user.email,
      first_name: storeUser.user.first_name,
      last_name: storeUser.user.last_name,
      phone: storeUser.user.phone,
      state: storeUser.user.state,
      created_at: storeUser.user.created_at,
      updated_at: storeUser.user.updated_at,
      // TODO: Add roles when relationship is properly set up
      roles: [],
    }));
  }

  async findOne(id: number) {
    // Auto-scoped
    const user = await this.prisma.store_users.findFirst({
      where: { id },
      include: {
        user: true,
        store: true,
      },
    });

    if (!user) throw new NotFoundException('Store user not found');
    return user;
  }

  async update(id: number, data: any) {
    await this.findOne(id);
    return this.prisma.store_users.update({
      where: { id },
      data,
    });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.store_users.delete({
      where: { id },
    });
  }
}
