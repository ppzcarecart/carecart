import {
  Controller,
  Get,
  Param,
  Query,
  Render,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';

import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { OptionalJwtAuthGuard } from '../common/guards/optional-jwt.guard';

import { ProductsService } from '../products/products.service';
import { CategoriesService } from '../categories/categories.service';
import { OrdersService } from '../orders/orders.service';
import { CartService } from '../cart/cart.service';
import { UsersService } from '../users/users.service';

@Controller()
export class ViewsController {
  constructor(
    private products: ProductsService,
    private categories: CategoriesService,
    private orders: OrdersService,
    private cart: CartService,
    private users: UsersService,
  ) {}

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get()
  @Render('shop/index')
  async home(@Req() req: Request, @Query('category') categorySlug?: string) {
    const categories = await this.categories.list();
    const activeCategory = categorySlug
      ? categories.find((c) => c.slug === categorySlug)
      : undefined;
    const [products, featured] = await Promise.all([
      this.products.list({
        activeOnly: true,
        categoryId: activeCategory?.id,
      }),
      // Only show the Featured rail when there is no category filter applied,
      // otherwise it would compete with the filtered grid below it.
      activeCategory
        ? Promise.resolve([])
        : this.products.list({ activeOnly: true, featuredOnly: true, limit: 8 }),
    ]);
    return {
      title: 'carecart',
      user: (req as any).user || null,
      products,
      featured,
      categories,
      activeCategorySlug: categorySlug || 'all',
    };
  }

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get('p/:slug')
  @Render('shop/product')
  async product(@Param('slug') slug: string, @Req() req: Request) {
    const product = await this.products.findBySlug(slug);
    return {
      title: product?.name || 'Product',
      user: (req as any).user || null,
      product,
    };
  }

  @Public()
  @Get('login')
  @Render('login')
  loginPage() {
    return { title: 'Sign in' };
  }

  @Public()
  @Get('register')
  @Render('register')
  registerPage() {
    return { title: 'Create account' };
  }

  @Get('cart')
  @Render('shop/cart')
  async cartPage(@CurrentUser() user: any) {
    const summary = await this.cart.summary(user.id);
    return { title: 'Your cart', user, summary };
  }

  @Get('orders')
  @Render('shop/orders')
  async myOrders(@CurrentUser() user: any) {
    const orders = await this.orders.listForUser(user.id);
    return { title: 'My orders', user, orders };
  }

  // ---- Admin / Manager dashboard ----
  @Roles(Role.ADMIN, Role.MANAGER)
  @Get('admin')
  @Render('admin/index')
  async admin(@CurrentUser() user: any) {
    const [users, products, categories, orders] = await Promise.all([
      this.users.list(),
      this.products.list({}),
      this.categories.list(),
      this.orders.listAll(),
    ]);
    return {
      title: 'Admin',
      user,
      counts: {
        users: users.length,
        products: products.length,
        categories: categories.length,
        orders: orders.length,
      },
      orders: orders.slice(0, 20),
    };
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Get('admin/users')
  @Render('admin/users')
  async adminUsers(@CurrentUser() user: any) {
    const users = await this.users.list();
    return { title: 'Users', user, users };
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Get('admin/products')
  @Render('admin/products')
  async adminProducts(@CurrentUser() user: any) {
    const products = await this.products.list({});
    const categories = await this.categories.list();
    const vendors = await this.users.list({ role: Role.VENDOR });
    return { title: 'Products', user, products, categories, vendors };
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Get('admin/categories')
  @Render('admin/categories')
  async adminCategories(@CurrentUser() user: any) {
    const categories = await this.categories.list();
    return { title: 'Categories', user, categories };
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Get('admin/orders')
  @Render('admin/orders')
  async adminOrders(@CurrentUser() user: any) {
    const orders = await this.orders.listAll();
    return { title: 'Orders', user, orders };
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Get('admin/import')
  @Render('admin/import')
  importPage(@CurrentUser() user: any) {
    return { title: 'Bulk import customers', user };
  }

  // ---- Vendor dashboard ----
  @Roles(Role.VENDOR, Role.ADMIN, Role.MANAGER)
  @Get('vendor')
  @Render('vendor/index')
  async vendor(@CurrentUser() user: any) {
    const products = await this.products.list({ vendorId: user.id });
    const sales = await this.orders.vendorSalesSummary(user.id);
    const orders = await this.orders.vendorOrders(user.id);
    return { title: 'Vendor dashboard', user, products, sales, orders };
  }

  @Roles(Role.VENDOR, Role.ADMIN, Role.MANAGER)
  @Get('vendor/products')
  @Render('vendor/products')
  async vendorProducts(@CurrentUser() user: any) {
    const products = await this.products.list({ vendorId: user.id });
    const categories = await this.categories.list();
    return { title: 'My products', user, products, categories };
  }
}
