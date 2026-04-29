import 'reflect-metadata';
import * as dotenv from 'dotenv';
dotenv.config();
import dataSource from './data-source';
import { User } from '../users/entities/user.entity';
import { Category } from '../categories/entities/category.entity';
import { Product } from '../products/entities/product.entity';
import { Role } from '../common/enums/role.enum';
import * as bcrypt from 'bcrypt';

async function main() {
  await dataSource.initialize();
  const users = dataSource.getRepository(User);
  const categories = dataSource.getRepository(Category);
  const products = dataSource.getRepository(Product);

  let admin = await users.findOne({ where: { email: 'admin@ppzshop.local' } });
  if (!admin) {
    admin = users.create({
      email: 'admin@ppzshop.local',
      passwordHash: await bcrypt.hash('ChangeMe!123', 10),
      name: 'Administrator',
      role: Role.ADMIN,
    });
    await users.save(admin);
  }

  let vendor = await users.findOne({ where: { email: 'vendor@ppzshop.local' } });
  if (!vendor) {
    vendor = users.create({
      email: 'vendor@ppzshop.local',
      passwordHash: await bcrypt.hash('ChangeMe!123', 10),
      name: 'Demo Vendor',
      vendorStoreName: 'Demo Vendor Store',
      role: Role.VENDOR,
    });
    await users.save(vendor);
  }

  let cat = await categories.findOne({ where: { slug: 'general' } });
  if (!cat) {
    cat = categories.create({ name: 'General', slug: 'general' });
    await categories.save(cat);
  }

  const count = await products.count();
  if (count === 0) {
    await products.save(
      products.create({
        name: 'Sample T-Shirt',
        slug: 'sample-t-shirt',
        description: 'Demo product seeded by seed.ts',
        priceCents: 1990,
        pointsPrice: 200,
        currency: 'SGD',
        stock: 50,
        vendorId: vendor.id,
        categoryId: cat.id,
      }),
    );
  }

  // eslint-disable-next-line no-console
  console.log('Seed complete. Admin: admin@ppzshop.local / ChangeMe!123');
  await dataSource.destroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
