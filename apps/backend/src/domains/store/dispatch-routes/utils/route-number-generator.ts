import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';

@Injectable()
export class RouteNumberGenerator {
  constructor(private readonly prisma: StorePrismaService) {}

  async generateNextNumber(store_id: number): Promise<string> {
    const now = new Date();
    const year = now.getFullYear().toString().slice(-2);
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const prefix = `PLN${year}${month}${day}`;

    const last = await this.prisma.dispatch_routes.findFirst({
      where: { store_id, route_number: { startsWith: prefix } },
      orderBy: { route_number: 'desc' },
    });

    let sequence = 1;
    if (last) {
      const last_seq = parseInt(last.route_number.slice(-4));
      sequence = last_seq + 1;
    }
    return `${prefix}${sequence.toString().padStart(4, '0')}`;
  }
}
