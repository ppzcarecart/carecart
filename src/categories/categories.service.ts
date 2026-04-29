import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';

import { Category } from './entities/category.entity';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { slugify } from '../common/utils/slugify';

@Injectable()
export class CategoriesService {
  constructor(@InjectRepository(Category) private repo: Repository<Category>) {}

  list() {
    return this.repo.find({ order: { name: 'ASC' }, relations: ['parent'] });
  }

  findById(id: string) {
    return this.repo.findOne({ where: { id }, relations: ['parent'] });
  }

  findBySlug(slug: string) {
    return this.repo.findOne({ where: { slug }, relations: ['parent'] });
  }

  async create(dto: CreateCategoryDto) {
    const slug = (dto.slug || slugify(dto.name)).toLowerCase();
    const parent = dto.parentId ? await this.findById(dto.parentId) : undefined;
    const cat = this.repo.create({
      name: dto.name,
      slug,
      description: dto.description,
      active: dto.active ?? true,
      parent: parent ?? undefined,
    });
    return this.repo.save(cat);
  }

  async update(id: string, dto: UpdateCategoryDto) {
    const cat = await this.findById(id);
    if (!cat) throw new NotFoundException('Category not found');
    if (dto.name) cat.name = dto.name;
    if (dto.slug !== undefined) cat.slug = dto.slug ? dto.slug.toLowerCase() : slugify(cat.name);
    if (dto.description !== undefined) cat.description = dto.description;
    if (dto.active !== undefined) cat.active = dto.active;
    if (dto.parentId !== undefined) {
      cat.parent = dto.parentId ? await this.findById(dto.parentId) : null;
    }
    return this.repo.save(cat);
  }

  async remove(id: string) {
    const cat = await this.findById(id);
    if (!cat) throw new NotFoundException('Category not found');
    await this.repo.remove(cat);
    return { ok: true };
  }
}
