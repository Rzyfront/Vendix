import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';

@Injectable()
export class StoreUsersService {
  constructor(private prisma: StorePrismaService) {}

  // TODO: Implement store users methods
}
