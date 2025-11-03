"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocationsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../../prisma/prisma.service");
let LocationsService = class LocationsService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    create(createLocationDto) {
        return this.prisma.inventory_locations.create({
            data: createLocationDto,
        });
    }
    findAll(query) {
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
    findOne(id) {
        return this.prisma.inventory_locations.findUnique({
            where: { id },
            include: {
                addresses: true,
            },
        });
    }
    update(id, updateLocationDto) {
        return this.prisma.inventory_locations.update({
            where: { id },
            data: updateLocationDto,
        });
    }
    remove(id) {
        return this.prisma.inventory_locations.update({
            where: { id },
            data: { is_active: false },
        });
    }
};
exports.LocationsService = LocationsService;
exports.LocationsService = LocationsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], LocationsService);
//# sourceMappingURL=locations.service.js.map