import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpsertVariantDto } from './dto/upsert-variant.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('api/products')
export class ProductsController {
  constructor(private products: ProductsService) {}

  @Public()
  @Get()
  list(
    @Query('q') q?: string,
    @Query('categoryId') categoryId?: string,
    @Query('vendorId') vendorId?: string,
  ) {
    return this.products.list({ q, categoryId, vendorId, activeOnly: true });
  }

  // Vendor view: returns all (active and inactive) products owned by the vendor
  @Roles(Role.VENDOR, Role.ADMIN, Role.MANAGER)
  @Get('mine')
  mine(@CurrentUser() user: any) {
    return this.products.list({ vendorId: user.id });
  }

  // Admin/manager view: list anything, no activeOnly filter
  @Roles(Role.ADMIN, Role.MANAGER)
  @Get('all')
  all(
    @Query('q') q?: string,
    @Query('categoryId') categoryId?: string,
    @Query('vendorId') vendorId?: string,
  ) {
    return this.products.list({ q, categoryId, vendorId });
  }

  @Public()
  @Get(':id')
  get(@Param('id') id: string) {
    return this.products.findById(id);
  }

  @Roles(Role.ADMIN, Role.MANAGER, Role.VENDOR)
  @Post()
  create(@Body() dto: CreateProductDto, @CurrentUser() user: any) {
    return this.products.create(dto, { id: user.id, role: user.role });
  }

  @Roles(Role.ADMIN, Role.MANAGER, Role.VENDOR)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
    @CurrentUser() user: any,
  ) {
    return this.products.update(id, dto, { id: user.id, role: user.role });
  }

  @Roles(Role.ADMIN, Role.MANAGER, Role.VENDOR)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.products.remove(id, { id: user.id, role: user.role });
  }

  // Variants
  @Roles(Role.ADMIN, Role.MANAGER, Role.VENDOR)
  @Post(':id/variants')
  upsertVariant(
    @Param('id') id: string,
    @Body() dto: UpsertVariantDto,
    @CurrentUser() user: any,
  ) {
    return this.products.upsertVariant(id, dto, { id: user.id, role: user.role });
  }

  @Roles(Role.ADMIN, Role.MANAGER, Role.VENDOR)
  @Delete(':id/variants/:variantId')
  removeVariant(
    @Param('id') id: string,
    @Param('variantId') variantId: string,
    @CurrentUser() user: any,
  ) {
    return this.products.removeVariant(id, variantId, { id: user.id, role: user.role });
  }

  // Images — append (max 8) and remove individual product images
  @Roles(Role.ADMIN, Role.MANAGER, Role.VENDOR)
  @Post(':id/images')
  addImage(
    @Param('id') id: string,
    @Body() body: { url: string },
    @CurrentUser() user: any,
  ) {
    return this.products.addImage(id, body?.url, { id: user.id, role: user.role });
  }

  @Roles(Role.ADMIN, Role.MANAGER, Role.VENDOR)
  @Delete(':id/images/:imageId')
  removeImage(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @CurrentUser() user: any,
  ) {
    return this.products.removeImage(id, imageId, { id: user.id, role: user.role });
  }

  // Featured (admin/manager only, max 8)
  @Roles(Role.ADMIN, Role.MANAGER)
  @Patch(':id/featured')
  setFeatured(@Param('id') id: string, @Body() body: { featured: boolean }) {
    return this.products.setFeatured(id, !!body?.featured);
  }

  // Stock
  @Roles(Role.ADMIN, Role.MANAGER, Role.VENDOR)
  @Patch(':id/stock')
  updateStock(
    @Param('id') id: string,
    @Body() body: { stock: number; variantId?: string },
    @CurrentUser() user: any,
  ) {
    if (typeof body?.stock !== 'number') throw new ForbiddenException('stock is required');
    return this.products.updateStock(id, body.variantId, body.stock, {
      id: user.id,
      role: user.role,
    });
  }
}
