import { PrismaService } from '../../../prisma/prisma.service';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { LocationQueryDto } from './dto/location-query.dto';
export declare class LocationsService {
    private prisma;
    constructor(prisma: PrismaService);
    create(createLocationDto: CreateLocationDto): any;
    findAll(query: LocationQueryDto): any;
    findOne(id: number): any;
    update(id: number, updateLocationDto: UpdateLocationDto): any;
    remove(id: number): any;
}
