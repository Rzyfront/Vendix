import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { EcommerceReviewsService } from './reviews.service';
import {
  CreateReviewDto,
  UpdateReviewDto,
  ReviewListQueryDto,
  VoteReviewDto,
  ReportReviewDto,
} from './dto';
import { Public } from '@common/decorators/public.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@Controller('ecommerce/reviews')
export class EcommerceReviewsController {
  constructor(private readonly reviews_service: EcommerceReviewsService) {}

  @Public()
  @Get()
  async getProductReviews(@Query() query: ReviewListQueryDto) {
    const data = await this.reviews_service.getProductReviews(query);
    return { success: true, data };
  }

  @UseGuards(JwtAuthGuard)
  @Get('can-review/:productId')
  async canReview(@Param('productId', ParseIntPipe) productId: number) {
    const data = await this.reviews_service.canReview(productId);
    return { success: true, data };
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  async create(@Body() dto: CreateReviewDto) {
    const data = await this.reviews_service.create(dto);
    return { success: true, data };
  }

  @UseGuards(JwtAuthGuard)
  @Put(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateReviewDto,
  ) {
    const data = await this.reviews_service.update(id, dto);
    return { success: true, data };
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    const data = await this.reviews_service.remove(id);
    return { success: true, data };
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/vote')
  async vote(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: VoteReviewDto,
  ) {
    const data = await this.reviews_service.vote(id, dto);
    return { success: true, data };
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/report')
  async report(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReportReviewDto,
  ) {
    const data = await this.reviews_service.report(id, dto);
    return { success: true, data };
  }
}
