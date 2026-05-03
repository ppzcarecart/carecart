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
import { SettingsService } from '../settings/settings.service';
import { CollectionService } from '../collection/collection.service';
import { PPZ_ROLES, PPZ_ROLE_LABELS } from '../users/ppz-role';
import * as QRCode from 'qrcode';

/**
 * Map a `?range=` query string to a date window for the sales report.
 * Defaults to "all" (no since/until). The `key` round-trips so the
 * template can mark the active dropdown option.
 */
function resolveSalesRange(range: string | undefined): {
  key: string;
  label: string;
  since?: Date;
  until?: Date;
} {
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const now = new Date();
  switch ((range || '').toLowerCase()) {
    case 'today': {
      const since = startOfDay(now);
      return { key: 'today', label: 'Today', since };
    }
    case '7d': {
      const since = startOfDay(now);
      since.setDate(since.getDate() - 6); // include today + previous 6 days
      return { key: '7d', label: 'Past 7 days', since };
    }
    case '30d': {
      const since = startOfDay(now);
      since.setDate(since.getDate() - 29);
      return { key: '30d', label: 'Past 30 days', since };
    }
    case 'month': {
      const since = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      return { key: 'month', label: 'This month', since };
    }
    default:
      return { key: 'all', label: 'All time' };
  }
}

interface SalesRow {
  productName: string;
  vendorId: string | null;
  unitsSold: number;
  revenueCents: number;
  pointsCollected: number;
}

function aggregateSalesTotals(rows: SalesRow[]) {
  return rows.reduce(
    (acc, r) => {
      acc.unitsSold += r.unitsSold;
      acc.revenueCents += r.revenueCents;
      acc.pointsCollected += r.pointsCollected;
      return acc;
    },
    { unitsSold: 0, revenueCents: 0, pointsCollected: 0 },
  );
}

@Controller()
export class ViewsController {
  constructor(
    private products: ProductsService,
    private categories: CategoriesService,
    private orders: OrdersService,
    private cart: CartService,
    private users: UsersService,
    private settings: SettingsService,
    private collection: CollectionService,
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
        : this.products.list({ activeOnly: true, featuredOnly: true, limit: 4 }),
      skipRails
        ? Promise.resolve([])
        : this.products.list({
            activeOnly: true,
            newSince,
            excludeFeatured: true,
            limit: 4,
          }),
    ]);
    const reqUser = (req as any).user || null;
    const isPpzMember = !!reqUser?.ppzId;
    this.products.enrichForView(products, isPpzMember);
    this.products.enrichForView(featured, isPpzMember);
    this.products.enrichForView(newProducts, isPpzMember);
    const hero = this.settings.homeHero();
    const bannersEnabled = this.settings.homeBannersEnabled();
    const banners = bannersEnabled ? this.settings.homeBanners() : [];
    return {
      title: 'carecart',
      user: reqUser,
      isPpzMember,
      products,
      featured,
      newProducts,
      categories,
      activeCategorySlug: categorySlug || 'all',
      hero,
      banners,
    };
  }

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Get('p/:slug')
  @Render('shop/product')
  async product(@Param('slug') slug: string, @Req() req: Request) {
    const product = await this.products.findBySlug(slug);
    const reqUser = (req as any).user || null;
    const isPpzMember = !!reqUser?.ppzId;
    if (product) this.products.enrichForView([product], isPpzMember);
    return {
      title: product?.name || 'Product',
      user: reqUser,
      isPpzMember,
      product,
      pointsPerDollar: this.settings.pointsPerDollar(),
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
  async cartPage(
    @CurrentUser() user: any,
    @Query('method') method?: string,
  ) {
    const fulfilmentMethod = method === 'collection' ? 'collection' : 'delivery';
    const summary = await this.cart.summary(user.id, fulfilmentMethod);
    const fullUser = await this.users.findById(user.id);
    const defaultShipping =
      (fullUser?.addresses || []).find((a: any) => a.isDefault) ||
      (fullUser?.addresses || [])[0] ||
      null;
    return { title: 'Your cart', user, summary, defaultShipping };
  }

  @Get('orders')
  @Render('shop/orders')
  async myOrders(@CurrentUser() user: any) {
    const orders = await this.orders.listForUser(user.id);
    return { title: 'My orders', user, orders };
  }

  @Get('orders/:id')
  @Render('order-detail')
  async customerOrderDetail(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    const order = await this.orders.findById(id);
    if (!order) throw new NotFoundException('Order not found');
    if (order.customerId !== user.id) {
      throw new ForbiddenException();
    }
    return {
      title: 'Order ' + order.number,
      user,
      order,
      customer: order.customer,
      activePath: '',
      returnTo: '/orders',
    };
  }

  // Customer-facing QR ticket. Only visible while the order is still
  // pending collection — once collected we send the customer back to
  // the order detail page where the collected timestamp shows.
  @Get('orders/:id/qr')
  @Render('shop/order-qr')
  async customerOrderQr(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    const order = await this.orders.findById(id);
    if (!order) throw new NotFoundException('Order not found');
    if (order.customerId !== user.id) {
      throw new ForbiddenException();
    }
    if (order.fulfilmentMethod !== 'collection') {
      throw new ForbiddenException(
        'This is a delivery order, no collection QR is needed.',
      );
    }
    const qrSvg = await QRCode.toString(order.number, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 260,
      color: { dark: '#0f172a', light: '#ffffff' },
    });
    return {
      title: 'Collect ' + order.number,
      user,
      order,
      qrSvg,
    };
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
      ppzRoleLabels: PPZ_ROLE_LABELS,
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
  async adminUsers(
    @CurrentUser() user: any,
    @Query('q') q?: string,
    @Query('role') role?: string,
    @Query('ppzRole') ppzRole?: string,
  ) {
    // Map empty strings to undefined so the service treats blank
    // dropdowns as "any" rather than filtering on ''.
    const filter: Parameters<typeof this.users.list>[0] = {};
    if (q && q.trim()) filter.q = q.trim();
    if (role) filter.role = role as Role;
    if (ppzRole) filter.ppzRole = ppzRole;

    const all = await this.users.list(filter);
    // Managers don't see admin accounts.
    const visible =
      user.role === Role.MANAGER
        ? all.filter((u) => u.role !== Role.ADMIN)
        : all;
    return {
      title: 'Users',
      user,
      users: visible,
      activePath: '/admin/users',
      filters: { q: q || '', role: role || '', ppzRole: ppzRole || '' },
      ppzRoles: PPZ_ROLES,
      ppzRoleLabels: PPZ_ROLE_LABELS,
    };
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Get('admin/users/:id')
  @Render('admin/user-detail')
  async adminUserDetail(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    const target = await this.users.findById(id);
    if (!target) throw new NotFoundException('User not found');
    // Managers can't see admin user records.
    if (user.role === Role.MANAGER && target.role === Role.ADMIN) {
      throw new ForbiddenException();
    }
    return {
      title: target.name,
      user,
      target,
      ppzRoles: PPZ_ROLES,
      ppzRoleLabels: PPZ_ROLE_LABELS,
      activePath: '/admin/users',
      returnTo: '/admin/users',
    };
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Get('admin/products')
  @Render('admin/products')
  async adminProducts(
    @CurrentUser() user: any,
    @Query('featured') featured?: string,
  ) {
    const featuredOnly = featured === 'true';
    const products = await this.products.list({
      featuredOnly: featuredOnly || undefined,
    });
    const categories = await this.categories.list();
    const vendors = await this.users.list({ role: Role.VENDOR });
    const disabledCount = (
      await this.products.list({ disabledOnly: true })
    ).length;
    return {
      title: 'Products',
      user,
      products,
      categories,
      vendors,
      disabledCount,
      featuredOnly,
      activePath: '/admin/products',
    };
  }

  // Products that are off-shelf because their vendor was disabled.
  // They reappear in /admin/products automatically when the vendor is
  // re-enabled (cascade in UsersService.update).
  @Roles(Role.ADMIN, Role.MANAGER)
  @Get('admin/products/disabled')
  @Render('admin/products-disabled')
  async adminDisabledProducts(@CurrentUser() user: any) {
    const products = await this.products.list({ disabledOnly: true });
    return {
      title: 'Disabled products',
      user,
      products,
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
  async adminOrders(
    @CurrentUser() user: any,
    @Query('status') status?: string,
  ) {
    const allowed = new Set([
      'pending', 'awaiting_payment', 'paid', 'fulfilled',
      'collected', 'cancelled', 'refunded',
    ]);
    const safeStatus = status && allowed.has(status) ? status : undefined;
    const orders = await this.orders.listAll({
      status: safeStatus as any,
    });
    return {
      title: 'Orders',
      user,
      orders,
      activeStatus: safeStatus || '',
      activePath: '/admin/orders',
    };
  }

  // Marketplace-wide sales report. Vendors get their own scoped
  // version under /vendor/sales below.
  @Roles(Role.ADMIN, Role.MANAGER)
  @Get('admin/sales')
  @Render('admin/sales')
  async adminSales(
    @CurrentUser() user: any,
    @Query('range') range?: string,
  ) {
    const r = resolveSalesRange(range);
    const [sales, lines] = await Promise.all([
      this.orders.salesSummary({ since: r.since, until: r.until }),
      this.orders.salesLines({ since: r.since, until: r.until }),
    ]);
    // Resolve vendor display names for every distinct vendorId in
    // either result set so the template can show a friendly label.
    const vendorIds = Array.from(
      new Set(
        [
          ...sales.map((s) => s.vendorId),
          ...lines.map((l) => l.vendorId),
        ].filter((v): v is string => !!v),
      ),
    );
    const vendorById = new Map<string, string>();
    for (const id of vendorIds) {
      const v = await this.users.findById(id);
      if (v) vendorById.set(id, v.vendorStoreName || v.name);
    }
    const totals = aggregateSalesTotals(sales);
    return {
      title: 'Sales report',
      user,
      sales,
      lines,
      vendorById: Object.fromEntries(vendorById),
      totals,
      range: r.key,
      rangeLabel: r.label,
      isAdmin: true,
      activePath: '/admin/sales',
    };
  }

  @Roles(Role.VENDOR, Role.ADMIN, Role.MANAGER)
  @Get('vendor/sales')
  @Render('admin/sales')
  async vendorSales(
    @CurrentUser() user: any,
    @Query('range') range?: string,
  ) {
    const r = resolveSalesRange(range);
    // Vendors see only their own products; admin/manager who land
    // here (e.g. impersonating a vendor view) get the same scope.
    const vendorId = user.role === Role.VENDOR ? user.id : user.id;
    const [sales, lines] = await Promise.all([
      this.orders.salesSummary({ vendorId, since: r.since, until: r.until }),
      this.orders.salesLines({ vendorId, since: r.since, until: r.until }),
    ]);
    const totals = aggregateSalesTotals(sales);
    return {
      title: 'Sales report',
      user,
      sales,
      lines,
      vendorById: {},
      totals,
      range: r.key,
      rangeLabel: r.label,
      isAdmin: false,
      activePath: '/vendor/sales',
    };
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Get('admin/orders/:id')
  @Render('order-detail')
  async adminOrderDetail(@Param('id') id: string, @CurrentUser() user: any) {
    const order = await this.orders.findById(id);
    if (!order) throw new NotFoundException('Order not found');
    return {
      title: 'Order ' + order.number,
      user,
      order,
      customer: order.customer,
      activePath: '/admin/orders',
      returnTo: '/admin/orders',
    };
  }

  @Roles(Role.VENDOR, Role.ADMIN, Role.MANAGER)
  @Get('vendor/orders/:id')
  @Render('order-detail')
  async vendorOrderDetail(@Param('id') id: string, @CurrentUser() user: any) {
    const order = await this.orders.findById(id);
    if (!order) throw new NotFoundException('Order not found');
    if (
      user.role === Role.VENDOR &&
      !order.items.some((i) => i.vendorId === user.id)
    ) {
      throw new ForbiddenException('This order does not contain your items');
    }
    return {
      title: 'Order ' + order.number,
      user,
      order,
      customer: order.customer,
      activePath: '/vendor',
      returnTo: '/vendor',
    };
  }

  // Camera-based QR scanner for collection. Admin/manager can collect
  // for any vendor; the vendor variant below limits scope server-side.
  @Roles(Role.ADMIN, Role.MANAGER)
  @Get('admin/collection')
  @Render('admin/collection')
  async adminCollection(@CurrentUser() user: any) {
    const logs = await this.collection.listLogs({
      id: user.id,
      role: user.role,
    });
    return {
      title: 'Manage Collection',
      user,
      logs,
      activePath: '/admin/collection',
      scope: 'all',
    };
  }

  @Roles(Role.VENDOR, Role.ADMIN, Role.MANAGER)
  @Get('vendor/collection')
  @Render('admin/collection')
  async vendorCollection(@CurrentUser() user: any) {
    const logs = await this.collection.listLogs({
      id: user.id,
      role: user.role,
    });
    return {
      title: 'Manage Collection',
      user,
      logs,
      activePath: '/vendor/collection',
      scope: user.role === Role.VENDOR ? 'vendor' : 'all',
    };
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Get('admin/import')
  @Render('admin/import')
  importPage(@CurrentUser() user: any) {
    return { title: 'Bulk import customers', user, activePath: '/admin/import' };
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Get('admin/settings')
  @Render('admin/settings')
  async settingsPage(@CurrentUser() user: any) {
    const all = await this.settings.getAll();
    return {
      title: 'Settings',
      user,
      activePath: '/admin/settings',
      settings: {
        pointsPerDollar: parseInt(all.pointsPerDollar || '50', 10),
        collection: {
          line1: all['collection.line1'] || '',
          line2: all['collection.line2'] || '',
          postalCode: all['collection.postalCode'] || '',
          contact: all['collection.contact'] || '',
          hours: all['collection.hours'] || '',
        },
        delivery: {
          enabled: all['delivery.enabled'] === 'true',
          feeCents: parseInt(all['delivery.feeCents'] || '0', 10),
        },
        partner: {
          closeUrl: all['partner.closeUrl'] || '',
        },
      },
    };
  }

  // Page Edit — admin/manager-only CMS-style editor for the storefront
  // home page (hero copy, hero tiles, promo banner carousel). Lives
  // separate from /admin/settings so the marketing-edit surface is
  // grouped on its own.
  @Roles(Role.ADMIN, Role.MANAGER)
  @Get('admin/pages')
  @Render('admin/pages')
  async pagesEditor(@CurrentUser() user: any) {
    return {
      title: 'Page Edit',
      user,
      activePath: '/admin/pages',
      hero: this.settings.homeHero(),
      bannersEnabled: this.settings.homeBannersEnabled(),
      banners: this.settings.homeBanners(),
    };
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
      pointsPerDollar: this.settings.pointsPerDollar(),
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
      pointsPerDollar: this.settings.pointsPerDollar(),
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
      pointsPerDollar: this.settings.pointsPerDollar(),
      returnTo,
      activePath: returnTo,
    };
  }

  @Roles(Role.VENDOR, Role.ADMIN, Role.MANAGER)
  @Get('vendor/settings')
  @Render('vendor/settings')
  async vendorSettings(@CurrentUser() user: any) {
    const me = await this.users.findById(user.id);
    const all = await this.settings.getAll();
    return {
      title: 'Vendor settings',
      user,
      vendor: me,
      adminCollection: {
        line1: all['collection.line1'] || '',
        line2: all['collection.line2'] || '',
        postalCode: all['collection.postalCode'] || '',
        contact: all['collection.contact'] || '',
        hours: all['collection.hours'] || '',
      },
      adminDeliveryEnabled: all['delivery.enabled'] === 'true',
      adminDeliveryFeeCents: parseInt(all['delivery.feeCents'] || '0', 10),
      activePath: '/vendor/settings',
    };
  }

  @Roles(Role.VENDOR, Role.ADMIN, Role.MANAGER)
  @Get('vendor/products')
  @Render('vendor/products')
  async vendorProducts(
    @CurrentUser() user: any,
    @Query('lowStock') lowStock?: string,
  ) {
    const all = await this.products.list({ vendorId: user.id });
    // Same low-stock rule the dashboard uses for the stat card —
    // any item or variant ≤ 5. Filtered server-side so the link
    // from the Low stock card lands on the relevant subset.
    const filterLowStock = lowStock === 'true';
    const products = filterLowStock
      ? all.filter((p) =>
          p.variants && p.variants.length
            ? p.variants.some((v) => v.stock <= 5)
            : p.stock <= 5,
        )
      : all;
    const categories = await this.categories.list();
    return {
      title: 'My products',
      user,
      products,
      categories,
      lowStockOnly: filterLowStock,
      activePath: '/vendor/products',
    };
  }
}
