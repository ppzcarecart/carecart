import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

/**
 * Thin client for the external Points system. The integrator will provide
 * the base URL, auth scheme, and exact endpoints later — fill them in here.
 *
 * All methods are designed to be safe to call with no config: they return
 * a "not_configured" placeholder rather than throwing, so the rest of the
 * order flow keeps working before the integration is wired up.
 */
@Injectable()
export class PointsClient {
  private readonly logger = new Logger(PointsClient.name);
  private http?: AxiosInstance;

  constructor(private config: ConfigService) {
    const baseURL = this.config.get<string>('POINTS_API_BASE_URL');
    const apiKey = this.config.get<string>('POINTS_API_KEY');
    if (baseURL) {
      this.http = axios.create({
        baseURL,
        timeout: 10_000,
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      });
    }
  }

  isConfigured() {
    return !!this.http;
  }

  /**
   * Look up balance for a customer. Replace path/payload to match the integrator's API.
   */
  async getBalance(accountId: string): Promise<{ balance: number } | { notConfigured: true }> {
    if (!this.http) return { notConfigured: true };
    try {
      const res = await this.http.get(`/accounts/${encodeURIComponent(accountId)}/balance`);
      return { balance: Number(res.data?.balance ?? 0) };
    } catch (e: any) {
      this.logger.warn(`Points getBalance failed: ${e.message}`);
      throw e;
    }
  }

  /**
   * Redeem points. Idempotency is keyed by orderId. Replace endpoint when ready.
   */
  async redeem(input: {
    accountId: string;
    amount: number;
    orderId: string;
    idempotencyKey: string;
  }): Promise<{ ref: string } | { notConfigured: true }> {
    if (!this.http) return { notConfigured: true };
    const res = await this.http.post(
      `/accounts/${encodeURIComponent(input.accountId)}/redeem`,
      { amount: input.amount, orderId: input.orderId },
      { headers: { 'Idempotency-Key': input.idempotencyKey } },
    );
    return { ref: res.data?.ref || res.data?.id || '' };
  }

  /**
   * Reverse a redemption (e.g. payment failed after redeem).
   */
  async reverse(input: {
    accountId: string;
    amount: number;
    orderId: string;
    originalRef?: string;
  }): Promise<{ ref: string } | { notConfigured: true }> {
    if (!this.http) return { notConfigured: true };
    const res = await this.http.post(
      `/accounts/${encodeURIComponent(input.accountId)}/reverse`,
      { amount: input.amount, orderId: input.orderId, ref: input.originalRef },
    );
    return { ref: res.data?.ref || '' };
  }
}
