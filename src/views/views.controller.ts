import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
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

    // Featured and New rails only render when no category filter is active.
    const newSince = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const skipRails = !!activeCategory;

    const [products, featured, newProducts] = await Promise.all([
      this.products.list({
        activeOnly: true,
        categoryId: activeCategory?.id,
      }),
      skipRails
        ? Promise.resolve([])
        : this.products.list({ activeOnly: true, featuredOnly: true, limit: 8 }),
      skipRails
        ? Promise.resolve([])
        : this.products.list({
            activeOnly: true,
            newSince,
            excludeFeatured: true,
            limit: 8,
          }),
    ]);
    const reqUser = (req as any).user || null;
    return {
      title: 'carecart',
      user: reqUser,
      isPpzMember: !!reqUser?.ppzId,
      products,
      featured,
      newProducts,
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
    const reqUser = (req as any).user || null;
    return {
      title: product?.name || 'Product',
      user: reqUser,
      isPpzMember: !!reqUser?.ppzId,
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

  @Get('profile')
  @Render('profile')
  async profile(@CurrentUser() user: any) {
    // user from JWT is enriched by JwtStrategy, but we want eager-loaded
    // addresses and the latest order count to render here.
    const fullUser = await this.users.findById(user.id);
    const orders = await this.orders.listForUser(user.id);
    return {
      title: 'My profile',
      user,
      profile: fullUser,
      orderCount: orders.length,
    };
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
    const vendorCount = users.filter((u) => u.role === Role.VENDOR).length;
    const customerCount = users.filter((u) => u.role === Role.CUSTOMER).length;
    const paidOrders = orders.filter(
      (o) => o.status === 'paid' || o.status === 'fulfilled',
    );
    const pendingOrders = orders.filter(
      (o) => o.status === 'awaiting_payment' || o.status === 'pending',
    );
    const revenueCents = paidOrders.reduce((sum, o) => sum + o.totalCents, 0);
    const featuredCount = products.filter((p) => p.featured).length;
    return {
      title: 'Admin',
      user,
      activePath: '/admin',
      counts: {
        users: users.length,
        vendors: vendorCount,
        customers: customerCount,
        products: products.length,
        featured: featuredCount,
        categories: categories.length,
        orders: orders.length,
        pending: pendingOrders.length,
        paid: paidOrders.length,
        revenueCents,
      },
      orders: orders.slice(0, 8),
    };
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Get('admin/users')
  @Render('admin/users')
  async adminUsers(@CurrentUser() user: any) {
    const users = await this.users.list();
    return { title: 'Users', user, users, activePath: '/admin/users' };
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Get('admin/products')
  @Render('admin/products')
  async adminProducts(@CurrentUser() user: any) {
    const products = await this.products.list({});
    const categories = await this.categories.list();
    const vendors = await this.users.list({ role: Role.VENDOR });
    return {
      title: 'Products',
      user,
      products,
      categories,
      vendors,
      activePath: '/admin/products',
    };
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Get('admin/categories')
  @Render('admin/categories')
  async adminCategories(@CurrentUser() user: any) {
    const categories = await this.categories.list();
    return { title: 'Categories', user, categories, activePath: '/admin/categories' };
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Get('admin/orders')
  @Render('admin/orders')
  async adminOrders(@CurrentUser() user: any) {
    const orders = await this.orders.listAll();
    return { title: 'Orders', user, orders, activePath: '/admin/orders' };
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Get('admin/import')
  @Render('admin/import')
  importPage(@CurrentUser() user: any) {
    return { title: 'Bulk import customers', user, activePath: '/admin/import' };
  }

  // ---- Vendor dashboard ----
  @Roles(Role.VENDOR, Role.ADMIN, Role.MANAGER)
  @Get('vendor')
  @Render('vendor/index')
  async vendor(@CurrentUser() user: any) {
    const products = await this.products.list({ vendorId: user.id });
    const sales = await this.orders.vendorSalesSummary(user.id);
    const orders = await this.orders.vendorOrders(user.id);
    const totalRevenueCents = sales.reduce((s, r) => s + r.revenueCents, 0);
    const totalUnits = sales.reduce((s, r) => s + r.unitsSold, 0);
    const lowStock = products.filter((p) => {
      if (p.variants && p.variants.length) {
        return p.variants.some((v) => v.stock <= 5);
      }
      return p.stock <= 5;
    });
    return {
      title: 'Vendor dashboard',
      user,
      products,
      sales,
      orders,
      stats: {
        productCount: products.length,
        totalUnits,
        totalRevenueCents,
        orderCount: orders.length,
        lowStockCount: lowStock.length,
      },
      activePath: '/vendor',
    };
  }

  // ---- New product (full-page form, mirrors edit layout) ----
  @Roles(Role.VENDOR)
  @Get('vendor/products/new')
  @Render('product-new')
  async vendorNewProduct(@CurrentUser() user: any) {
    const categories = await this.categories.list();
    return {
      title: 'New product',
      user,
      categories,
      vendors: [],
      isAdmin: false,
      returnTo: '/vendor/products',
      activePath: '/vendor/products',
    };
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Get('admin/products/new')
  @Render('product-new')
  async adminNewProduct(@CurrentUser() user: any) {
    const [categories, vendors] = await Promise.all([
      this.categories.list(),
      this.users.list({ role: Role.VENDOR }),
    ]);
    // Sort so PPZ Fulfilment is first in the dropdown.
    const ppz = vendors.find(
      (v) => v.email === 'ppz-fulfilment@carecart.local',
    );
    const sortedVendors = ppz
      ? [ppz, ...vendors.filter((v) => v.id !== ppz.id)]
      : vendors;
    return {
      title: 'New product',
      user,
      categories,
      vendors: sortedVendors,
      defaultVendorId: ppz?.id,
      isAdmin: true,
      returnTo: '/admin/products',
      activePath: '/admin/products',
    };
  }

  // ---- Edit product ----
  // Shared template used from both /vendor/products/:id/edit and
  // /admin/products/:id/edit. Vendors can only edit products they own.
  @Roles(Role.VENDOR, Role.ADMIN, Role.MANAGER)
  @Get('vendor/products/:id/edit')
  @Render('product-edit')
  async vendorEditProduct(@Param('id') id: string, @CurrentUser() user: any) {
    return this.renderEditProduct(id, user, '/vendor/products');
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Get('admin/products/:id/edit')
  @Render('product-edit')
  async adminEditProduct(@Param('id') id: string, @CurrentUser() user: any) {
    return this.renderEditProduct(id, user, '/admin/products');
  }

  private async renderEditProduct(id: string, user: any, returnTo: string) {
    const product = await this.products.findById(id);
    if (!product) throw new NotFoundException('Product not found');
    if (user.role === Role.VENDOR && product.vendorId !== user.id) {
      throw new ForbiddenException('You can only edit your own products');
    }
    const categories = await this.categories.list();
    return {
      title: 'Edit ' + product.name,
      user,
      product,
      categories,
      returnTo,
      activePath: returnTo,
    };
  }

  @Roles(Role.VENDOR, Role.ADMIN, Role.MANAGER)
  @Get('vendor/products')
  @Render('vendor/products')
  async vendorProducts(@CurrentUser() user: any) {
    const products = await this.products.list({ vendorId: user.id });
    const categories = await this.categories.list();
    return {
      title: 'My products',
      user,
      products,
      categories,
      activePath: '/vendor/products',
    };
  }
}
