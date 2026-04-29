import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CartService } from './cart.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PricingMode } from './entities/cart-item.entity';

@Controller('api/cart')
export class CartController {
  constructor(private cart: CartService) {}

  @Get()
  get(@CurrentUser() user: any) {
    return this.cart.summary(user.id);
  }

  @Post('items')
  add(
    @CurrentUser() user: any,
    @Body()
    body: {
      productId: string;
      variantId?: string;
      quantity: number;
      pricingMode?: PricingMode;
    },
  ) {
    return this.cart.addItem(
      user.id,
      body.productId,
      body.variantId,
      body.quantity ?? 1,
      body.pricingMode ?? 'price',
    );
  }

  @Patch('items/:id')
  update(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: { quantity: number },
  ) {
    return this.cart.updateItem(user.id, id, body.quantity);
  }

  @Delete('items/:id')
  remove(@CurrentUser() user: any, @Param('id') id: string) {
    return this.cart.removeItem(user.id, id);
  }

  @Delete()
  clear(@CurrentUser() user: any) {
    return this.cart.clear(user.id);
  }
}
