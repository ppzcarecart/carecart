import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';

import { PointsTransaction } from './entities/points-transaction.entity';
import { PointsClient, PpzUpdateResult, PpzUser } from './points.client';
import { UsersService } from '../users/users.service';
import { User } from '../users/entities/user.entity';
import { Address } from '../users/entities/address.entity';

@Injectable()
export class PointsService {
  private readonly logger = new Logger(PointsService.name);

  constructor(
    @InjectRepository(PointsTransaction)
    private repo: Repository<PointsTransaction>,
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @InjectRepository(Address)
    private addressRepo: Repository<Address>,
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
  async redeem(
    userId: string,
    amount: number,
    orderId: string,
    orderNumber?: string,
  ) {
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
        // Use the human-readable order number in the partner app's
        // transaction history; fall back to the UUID only if missing.
        reason: `carecart order ${orderNumber || orderId}`,
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

  /**
   * Admin-only operation: credit a fixed amount to a PPZ-linked user.
   * Calls the partner API with operation: add and the supplied reason as
   * the description, then updates our cached balance from the response.
   * Records a points_transactions row tagged meta.type = 'admin_add'.
   */
  async addPoints(userId: string, amount: number, reason: string) {
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) {
      throw new BadRequestException('amount must be a positive integer');
    }
    const trimmed = (reason || '').trim();
    if (!trimmed) {
      throw new BadRequestException('A reason is required');
    }
    if (trimmed.length > 500) {
      throw new BadRequestException('Reason is too long (max 500)');
    }
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    if (!user.ppzId) {
      throw new BadRequestException('User is not linked to a PPZ account');
    }
    if (!this.client.isConfigured()) {
      throw new BadRequestException('PPZ API is not configured');
    }

    const tx = this.repo.create({
      userId,
      kind: 'adjust',
      amount,
      status: 'pending',
      meta: { type: 'admin_add', reason: trimmed },
    });
    await this.repo.save(tx);

    try {
      const res = await this.client.add({
        ppzid: user.ppzId,
        amount,
        reason: trimmed,
      });
      if ('notConfigured' in res) {
        throw new BadRequestException('PPZ API is not configured');
      }
      await this.applyResultToUser(user, res);
      tx.status = 'confirmed';
      tx.externalRef = String(res.newPPZCurrency);
      tx.meta = { type: 'admin_add', reason: trimmed, ...(res as any) };
      await this.repo.save(tx);
      return {
        ok: true,
        newPpzCurrency: res.newPPZCurrency,
        newLifetimePpzCurrency: res.newLifetimePPZCurrency,
      };
    } catch (e: any) {
      tx.status = 'failed';
      tx.meta = { type: 'admin_add', reason: trimmed, error: e.message };
      await this.repo.save(tx);
      throw e;
    }
  }

  /**
   * Explicit refund triggered by admin/manager/vendor. Same operation:add
   * remote call as reverse() but with an admin-action reason text. Always
   * records a local audit row, even when the partner API is offline, so
   * the order can still be marked refunded and reconciled later.
   */
  async refund(
    userId: string,
    amount: number,
    orderId: string,
    orderNumber?: string,
    reason?: string,
  ) {
    if (amount <= 0) return { skipped: true };
    const tx = this.repo.create({
      userId,
      orderId,
      kind: 'reverse',
      amount,
      status: 'pending',
      meta: { type: 'refund', reason: reason || null },
    });
    await this.repo.save(tx);

    const user = await this.users.findById(userId);
    if (!user?.ppzId || !this.client.isConfigured()) {
      tx.meta = {
        type: 'refund',
        reason: reason || null,
        skipReason: 'PPZ API not configured or user not linked',
      };
      await this.repo.save(tx);
      return { recorded: true, remote: false };
    }

    // Description for the partner-app transaction history. Always starts
    // with "Refund" so it's filterable on their side.
    const headline = orderNumber ? `Refund - ${orderNumber}` : 'Refund';
    const remoteReason = reason ? `${headline}: ${reason}` : headline;

    try {
      const res = await this.client.add({
        ppzid: user.ppzId,
        amount,
        reason: remoteReason,
      });
      if ('notConfigured' in res) {
        await this.repo.save(tx);
        return { recorded: true, remote: false };
      }
      await this.applyResultToUser(user, res);
      tx.status = 'reversed';
      tx.externalRef = String(res.newPPZCurrency);
      tx.meta = { type: 'refund', ...(res as any) };
      await this.repo.save(tx);
      return { recorded: true, remote: true };
    } catch (e: any) {
      tx.status = 'failed';
      tx.meta = { type: 'refund', error: e.message };
      await this.repo.save(tx);
      this.logger.error(`PPZ refund failed for order ${orderId}: ${e.message}`);
      return { recorded: true, remote: false };
    }
  }

  /** Reverse PPZ redeem (e.g. payment failed after redeem). */
  async reverse(
    userId: string,
    amount: number,
    orderId: string,
    orderNumber?: string,
  ) {
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
        reason: `carecart order ${orderNumber || orderId} reversed`,
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

  /**
   * Re-fetch the full profile from the partner app and overwrite every
   * field carecart caches locally. Source of truth is the partner app.
   *
   * Updated fields:
   *   - name             ← remote.fullname
   *   - contact          ← remote.contact
   *   - email            ← remote.email   (skipped if it would collide with another user)
   *   - default address  ← remote.address (replaces the user's default; creates one if missing)
   *   - team             ← remote.team
   *   - ppzCurrency      ← remote.ppzcurrency
   *   - lifetimePpzCurrency ← remote.lifetimeppzcurrency
   */
  async syncProfile(userId: string) {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    if (!user.ppzId) return { user, notLinked: true as const };
    if (!this.client.isConfigured()) return { user, notConfigured: true as const };

    const remote = await this.client.getUser(user.ppzId);
    return { user: await this.applyRemoteToUser(user, remote), remote };
  }

  /**
   * Bulk-sync every user that has a ppzId. Used by the /admin/users
   * "Sync all PPZ users" action so the displayed balance / lifetime /
   * team match the partner app at a single point in time. Runs with a
   * small concurrency cap so we don't hammer the partner endpoint.
   */
  async syncAllPpzUsers(): Promise<{
    total: number;
    synced: number;
    failed: number;
    skipped: number;
  }> {
    const users = await this.userRepo.find({
      where: { ppzId: Not(IsNull()) },
      select: ['id'],
    });
    let synced = 0;
    let failed = 0;
    let skipped = 0;
    const concurrency = 3;
    for (let i = 0; i < users.length; i += concurrency) {
      const batch = users.slice(i, i + concurrency);
      const results = await Promise.allSettled(
        batch.map((u) => this.syncProfile(u.id)),
      );
      for (const r of results) {
        if (r.status === 'fulfilled') {
          const v = r.value as any;
          if (v.notLinked || v.notConfigured) skipped++;
          else synced++;
        } else {
          this.logger.warn(`syncAll: ${r.reason?.message || r.reason}`);
          failed++;
        }
      }
    }
    return { total: users.length, synced, failed, skipped };
  }

  /**
   * Apply a freshly-fetched PPZ record to an in-memory user, persist
   * everything (user row + default address) and return the saved user.
   * Public so the handoff flow can reuse it without re-fetching.
   */
  async applyRemoteToUser(user: User, remote: PpzUser): Promise<User> {
    // Always overwrite — partner app is the source of truth.
    user.ppzCurrency = remote.ppzcurrency;
    user.lifetimePpzCurrency = remote.lifetimeppzcurrency;
    user.team = remote.team;
    if (remote.fullname) user.name = remote.fullname;
    if (remote.contact) user.contact = remote.contact;

    // Email: only switch if it actually differs and won't collide with
    // another local account (which would block them from logging in).
    if (
      remote.email &&
      remote.email.toLowerCase().trim() !== user.email
    ) {
      const incoming = remote.email.toLowerCase().trim();
      const collision = await this.users.findByEmail(incoming);
      if (!collision || collision.id === user.id) {
        user.email = incoming;
      } else {
        this.logger.warn(
          `Skipping email sync for ${user.id}: ${incoming} already used by ${collision.id}`,
        );
      }
    }

    await this.userRepo.save(user);

    // Default shipping address: replace its line1 with the partner record,
    // or create one if the user has no address yet.
    if (remote.address) {
      const addresses = (user.addresses || []).slice();
      let defaultAddr =
        addresses.find((a) => a.isDefault) || addresses[0] || null;
      if (defaultAddr) {
        defaultAddr.line1 = remote.address;
        defaultAddr.label = defaultAddr.label || 'shipping';
        defaultAddr.isDefault = true;
        await this.addressRepo.save(defaultAddr);
      } else {
        const created = this.addressRepo.create({
          userId: user.id,
          line1: remote.address,
          label: 'shipping',
          isDefault: true,
          country: 'SG',
        });
        await this.addressRepo.save(created);
      }
    }

    // Re-load to pick up the addresses relation freshly (eager).
    const saved = await this.users.findById(user.id);
    return saved ?? user;
  }
}
