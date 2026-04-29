import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PointsTransaction } from './entities/points-transaction.entity';
import { PointsClient } from './points.client';
import { UsersService } from '../users/users.service';

@Injectable()
export class PointsService {
  private readonly logger = new Logger(PointsService.name);

  constructor(
    @InjectRepository(PointsTransaction)
    private repo: Repository<PointsTransaction>,
    private client: PointsClient,
    private users: UsersService,
  ) {}

  async getBalance(userId: string) {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    if (!user.pointsAccountId) return { balance: 0, notLinked: true };
    if (!this.client.isConfigured()) return { balance: 0, notConfigured: true };
    return this.client.getBalance(user.pointsAccountId);
  }

  /** Idempotent per orderId. Records local audit row regardless of remote success. */
  async redeem(userId: string, amount: number, orderId: string) {
    if (amount <= 0) return { skipped: true };
    const tx = this.repo.create({
      userId,
      orderId,
      kind: 'redeem',
      amount,
      status: 'pending',
    });
    await this.repo.save(tx);

    const user = await this.users.findById(userId);
    if (!user?.pointsAccountId || !this.client.isConfigured()) {
      tx.status = 'pending';
      tx.meta = { reason: 'points-system not configured or user not linked' };
      await this.repo.save(tx);
      return { recorded: true, remote: false };
    }

    try {
      const res = await this.client.redeem({
        accountId: user.pointsAccountId,
        amount,
        orderId,
        idempotencyKey: `redeem:${orderId}`,
      });
      tx.status = 'confirmed';
      if ('ref' in res) tx.externalRef = res.ref;
      await this.repo.save(tx);
      return { recorded: true, remote: true };
    } catch (e: any) {
      tx.status = 'failed';
      tx.meta = { error: e.message };
      await this.repo.save(tx);
      throw e;
    }
  }

  async reverse(userId: string, amount: number, orderId: string) {
    if (amount <= 0) return { skipped: true };
    const tx = this.repo.create({
      userId,
      orderId,
      kind: 'reverse',
      amount,
      status: 'pending',
    });
    await this.repo.save(tx);

    const user = await this.users.findById(userId);
    if (!user?.pointsAccountId || !this.client.isConfigured()) {
      tx.status = 'pending';
      await this.repo.save(tx);
      return { recorded: true, remote: false };
    }

    try {
      const res = await this.client.reverse({
        accountId: user.pointsAccountId,
        amount,
        orderId,
      });
      tx.status = 'reversed';
      if ('ref' in res) tx.externalRef = res.ref;
      await this.repo.save(tx);
      return { recorded: true, remote: true };
    } catch (e: any) {
      tx.status = 'failed';
      tx.meta = { error: e.message };
      await this.repo.save(tx);
      this.logger.error(`Points reverse failed for order ${orderId}: ${e.message}`);
      // Don't rethrow on reverse — order should still cancel.
      return { recorded: true, remote: false };
    }
  }
}
