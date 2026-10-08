import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Public } from '@common/decorators/public.decorator';
import { ResponseService } from '@common/responses/response.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { OrderReviewsService } from './order-reviews.service';
import {
  CreateOrderProductReviewDto,
  CreateOrderReviewDto,
} from './dto/order-review.dto';

@Controller('ecommerce/order-reviews')
export class OrderReviewsController {
  constructor(
    private readonly order_reviews_service: OrderReviewsService,
    private readonly response_service: ResponseService,
  ) {}

  @Public()
  @Get('by-token/:token')
  async getStatusByToken(@Param('token') token: string) {
    const data = await this.order_reviews_service.getStatus({ token });
    return this.response_service.success(data);
  }

  @Public()
  @Post('by-token/:token')
  @HttpCode(201)
  async createExperienceByToken(
    @Param('token') token: string,
    @Body() dto: CreateOrderReviewDto,
  ) {
    const data = await this.order_reviews_service.createExperience(
      { token },
      dto,
    );
    return this.response_service.created(data);
  }

  @Public()
  @Post('by-token/:token/products')
  @HttpCode(201)
  async createProductReviewByToken(
    @Param('token') token: string,
    @Body() dto: CreateOrderProductReviewDto,
  ) {
    const data = await this.order_reviews_service.createProductReview(
      { token },
      dto,
    );
    return this.response_service.created(data);
  }

  @UseGuards(JwtAuthGuard)
  @Get('orders/:orderId')
  async getStatusByOrder(@Param('orderId', ParseIntPipe) order_id: number) {
    const data = await this.order_reviews_service.getStatus({ order_id });
    return this.response_service.success(data);
  }

  @UseGuards(JwtAuthGuard)
  @Post('orders/:orderId')
  @HttpCode(201)
  async createExperienceByOrder(
    @Param('orderId', ParseIntPipe) order_id: number,
    @Body() dto: CreateOrderReviewDto,
  ) {
    const data = await this.order_reviews_service.createExperience(
      { order_id },
      dto,
    );
    return this.response_service.created(data);
  }

  @UseGuards(JwtAuthGuard)
  @Post('orders/:orderId/products')
  @HttpCode(201)
  async createProductReviewByOrder(
    @Param('orderId', ParseIntPipe) order_id: number,
    @Body() dto: CreateOrderProductReviewDto,
  ) {
    const data = await this.order_reviews_service.createProductReview(
      { order_id },
      dto,
    );
    return this.response_service.created(data);
  }
}
