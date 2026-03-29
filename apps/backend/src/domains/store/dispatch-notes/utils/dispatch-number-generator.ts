import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';

@Injectable()
export class DispatchNumberGenerator {
  constructor(private readonly prisma: StorePrismaService) {}

  async generateNextNumber(store_id: number): Promise<string> {
    const now = new Date();
    const year = now.getFullYear().toString().slice(-2);
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const prefix = `REM${year}${month}${day}`;

    const last_dispatch = await this.prisma.dispatch_notes.findFirst({
      where: {
        store_id,
        dispatch_number: { startsWith: prefix },
      },
      orderBy: { dispatch_number: 'desc' },
    });

    let sequence = 1;
    if (last_dispatch) {
      const last_sequence = parseInt(last_dispatch.dispatch_number.slice(-4));
      sequence = last_sequence + 1;
    }
    return `${prefix}${sequence.toString().padStart(4, '0')}`;
  }
}
