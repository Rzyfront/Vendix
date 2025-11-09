import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { LocationQueryDto } from './dto/location-query.dto';

@Injectable()
export class LocationsService {
  constructor(private prisma: PrismaService) {}

  create(createLocationDto: CreateLocationDto) {
    return this.prisma.inventory_locations.create({
      data: createLocationDto,
    });
  }

  findAll(query: LocationQueryDto) {
    return this.prisma.inventory_locations.findMany({
      where: {
        type: query.type,
        is_active: query.is_active,
      },
      include: {
        addresses: true,
      },
    });
  }

  findOne(id: number) {
    return this.prisma.inventory_locations.findUnique({
      where: { id },
      include: {
        addresses: true,
      },
    });
  }

  update(id: number, updateLocationDto: UpdateLocationDto) {
    return this.prisma.inventory_locations.update({
      where: { id },
      data: updateLocationDto,
    });
  }

  remove(id: number) {
    return this.prisma.inventory_locations.update({
      where: { id },
      data: { is_active: false },
    });
  }
}
