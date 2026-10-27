import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { CreateSeasonDto, UpdateSeasonDto } from './dto';

const toDate = (date: string) => new Date(`${date}T00:00:00.000Z`);
const toDateOnly = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Hospitality Suite (H2.2) — demand seasons ("Alta: 15-dic al 15-ene"). Each
 * plan prices a season per room type (see LodgingRatePlansService). When two
 * active seasons overlap, the higher priority wins; two active seasons with
 * the same priority cannot overlap, so a night never has two candidates.
 * Seasons are switched off, not deleted (sold nights keep their snapshot).
 */
@Injectable()
export class LodgingSeasonsService {
  constructor(private readonly prisma: StorePrismaService) {}

  findAll() {
    return this.prisma.lodging_seasons.findMany({
      orderBy: [{ from_date: 'asc' }, { priority: 'desc' }, { id: 'asc' }],
    });
  }

  async findOne(id: number) {
    const season = await this.prisma.lodging_seasons.findFirst({ where: { id } });
    if (!season) {
      throw new VendixHttpException(ErrorCodes.LODGING_SEASON_FIND_001);
    }
    return season;
  }

  async create(dto: CreateSeasonDto) {
    const store_id = this.requireStoreId();
    const season = {
      name: dto.name,
      from_date: dto.from_date,
      to_date: dto.to_date,
      priority: dto.priority ?? 0,
      is_active: dto.is_active ?? true,
    };
    const id = await this.save(store_id, async (tx, now) => {
      await this.assertNoTie(tx, store_id, season);
      const created = await tx.lodging_seasons.create({
        data: {
          store_id,
          name: season.name,
          from_date: toDate(season.from_date),
          to_date: toDate(season.to_date),
          priority: season.priority,
          ...(dto.color ? { color: dto.color.toUpperCase() } : {}),
          is_active: season.is_active,
          updated_at: now,
        },
      });
      return created.id;
    });
    return this.findOne(id);
  }

  async update(id: number, dto: UpdateSeasonDto) {
    const store_id = this.requireStoreId();
    const current = await this.findOne(id);
    const season = {
      id: current.id,
      name: dto.name ?? current.name,
      from_date: dto.from_date ?? toDateOnly(current.from_date),
      to_date: dto.to_date ?? toDateOnly(current.to_date),
      priority: dto.priority ?? current.priority,
      is_active: dto.is_active ?? current.is_active,
    };
    await this.save(store_id, async (tx, now) => {
      await this.assertNoTie(tx, store_id, season);
      await tx.lodging_seasons.update({
        where: { id: current.id },
        data: {
          name: season.name,
          from_date: toDate(season.from_date),
          to_date: toDate(season.to_date),
          priority: season.priority,
          ...(dto.color ? { color: dto.color.toUpperCase() } : {}),
          is_active: season.is_active,
          updated_at: now,
        },
      });
      return current.id;
    });
    return this.findOne(id);
  }

  /**
   * Dates in order, and no other active season of the same priority sharing
   * a night: the form asks for a different priority to decide which wins.
   */
  private async assertNoTie(
    tx: Prisma.TransactionClient,
    store_id: number,
    season: { id?: number; from_date: string; to_date: string; priority: number; is_active: boolean },
  ) {
    if (season.to_date < season.from_date) {
      throw new VendixHttpException(ErrorCodes.LODGING_SEASON_DATES_001);
    }
    if (!season.is_active) return;
    const clash = await tx.lodging_seasons.findFirst({
      where: {
        store_id,
        is_active: true,
        priority: season.priority,
        from_date: { lte: toDate(season.to_date) },
        to_date: { gte: toDate(season.from_date) },
        ...(season.id ? { id: { not: season.id } } : {}),
      },
      select: { name: true },
    });
    if (clash) {
      throw new VendixHttpException(
        ErrorCodes.LODGING_SEASON_OVERLAP_001,
        `Se solapa con la temporada ${clash.name}, que tiene la misma prioridad (${season.priority}). Cambia la prioridad para decidir cuál gana.`,
      );
    }
  }

  /** Runs a season write in a transaction; a duplicate name becomes a 409. */
  private async save(
    store_id: number,
    work: (tx: Prisma.TransactionClient, now: Date) => Promise<number>,
  ): Promise<number> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // One writer per store: the overlap check and the write stay atomic.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`lodging_seasons:${store_id}`}))`;
        return work(tx, new Date());
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new VendixHttpException(ErrorCodes.LODGING_SEASON_DUP_001);
      }
      throw error;
    }
  }

  private requireStoreId(): number {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    return store_id;
  }
}
