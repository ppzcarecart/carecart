import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PointsTransaction } from './entities/points-transaction.entity';
import { PointsClient, PpzUpdateResult } from './points.client';
import { UsersService } from '../users/users.service';
import { User } from '../users/entities/user.entity';

@Injectable()
export class PointsService {
  private readonly logger = new Logger(PointsService.name);

  constructor(
    @InjectRepository(PointsTransaction)
    private repo: Repository<PointsTransaction>,
    @InjectRepository(User)
    private userRepo: Repository<User>,
    private client: PointsClient,
    private users: UsersService,
  ) {}

  async getBalance(userId: string) {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    if (!user.ppzId) return { balance: user.ppzCurrency ?? 0, notLinked: true };
    if (!this.client.isConfigured()) {
      return { balance: user.ppzCurrency ?? 0, notConfigured: true };
    }
    const remote = await this.client.getBalance(user.ppzId);
    if ('notConfigured' in remote) {
      return { balance: user.ppzCurrency ?? 0, notConfigured: true };
    }
    // Update local cache so future reads / dashboards stay fresh.
    if (
      remote.balance !== user.ppzCurrency ||
      remote.lifetime !== user.lifetimePpzCurrency
    ) {
      user.ppzCurrency = remote.balance;
      user.lifetimePpzCurrency = remote.lifetime;
      await this.userRepo.save(user);
    }
    return { balance: remote.balance, lifetime: remote.lifetime };
  }

  /**
   * Deduct PPZ currency for an order. Local audit row is recorded even if
   * the remote call no-ops because the API isn't configured yet.
   */
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
    if (!user?.ppzId || !this.client.isConfigured()) {
      tx.meta = { reason: 'PPZ API not configured or user has no ppzId' };
      await this.repo.save(tx);
      return { recorded: true, remote: false };
    }

    try {
      const res = await this.client.deduct({
        ppzid: user.ppzId,
        amount,
        reason: `carecart order ${orderId}`,
      });
      if ('notConfigured' in res) {
        await this.repo.save(tx);
        return { recorded: true, remote: false };
      }
      await this.applyResultToUser(user, res);
      tx.status = 'confirmed';
      tx.externalRef = String(res.newPPZCurrency);
      tx.meta = res as any;
      await this.repo.save(tx);
      return { recorded: true, remote: true };
    } catch (e: any) {
      tx.status = 'failed';
      tx.meta = { error: e.message, code: e.code };
      await this.repo.save(tx);
      throw e;
    }
  }

  /** Refund PPZ currency (e.g. payment failed after redeem). */
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
    if (!user?.ppzId || !this.client.isConfigured()) {
      await this.repo.save(tx);
      return { recorded: true, remote: false };
    }

    try {
      const res = await this.client.add({
        ppzid: user.ppzId,
        amount,
        reason: `carecart order ${orderId} reversed`,
      });
      if ('notConfigured' in res) {
        await this.repo.save(tx);
        return { recorded: true, remote: false };
      }
      await this.applyResultToUser(user, res);
      tx.status = 'reversed';
      tx.externalRef = String(res.newPPZCurrency);
      tx.meta = res as any;
      await this.repo.save(tx);
      return { recorded: true, remote: true };
    } catch (e: any) {
      tx.status = 'failed';
      tx.meta = { error: e.message };
      await this.repo.save(tx);
      this.logger.error(`PPZ reverse failed for order ${orderId}: ${e.message}`);
      // Don't rethrow on reverse — order should still cancel.
      return { recorded: true, remote: false };
    }
  }

  private async applyResultToUser(user: User, res: PpzUpdateResult) {
    user.ppzCurrency = res.newPPZCurrency;
    user.lifetimePpzCurrency = res.newLifetimePPZCurrency;
    await this.userRepo.save(user);
  }
}
