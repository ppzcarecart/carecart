import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance } from 'axios';

/**
 * Client for the PPZ Ecom API. Two endpoints:
 *   GET  ecomgetuser?ppzid=X      → user profile + ppzcurrency
 *   PATCH ecomupdateppz           → operation: 'add' | 'deduct'
 *
 * Authentication is via x-api-key header. The key MUST stay server-side.
 *
 * All methods are safe to call when the key is missing — they return
 * `{ notConfigured: true }` so the rest of the order flow keeps working
 * before the integration is wired up on Railway.
 */

export interface PpzUser {
  ppzid: string;
  fullname: string;
  email: string;
  contact: string;
  address: string;
  ppzcurrency: number;
  lifetimeppzcurrency: number;
  team: number;
}

export interface PpzUpdateResult {
  success: boolean;
  ppzid: string;
  newPPZCurrency: number;
  newLifetimePPZCurrency: number;
}

@Injectable()
export class PointsClient {
  private readonly logger = new Logger(PointsClient.name);
  private apiKey?: string;
  private getUserUrl: string;
  private updatePpzUrl: string;
  private http: AxiosInstance;

  constructor(private config: ConfigService) {
    // Accept either PPZ_* (canonical) or POINTS_* (legacy) for back-compat.
    this.apiKey =
      this.config.get<string>('PPZ_API_KEY') ||
      this.config.get<string>('POINTS_API_KEY');

    this.getUserUrl =
      this.config.get<string>('PPZ_GET_USER_URL') ||
      'https://ecomgetuser-grp3nuwoda-uc.a.run.app';

    this.updatePpzUrl =
      this.config.get<string>('PPZ_UPDATE_PPZ_URL') ||
      'https://ecomupdateppz-grp3nuwoda-uc.a.run.app';

    this.http = axios.create({ timeout: 10_000 });
  }

  isConfigured() {
    return !!this.apiKey;
  }

  private headers() {
    return {
      'x-api-key': this.apiKey!,
      'Content-Type': 'application/json',
    };
  }

  /** Look up a PPZ user by their external id. */
  async getUser(ppzid: string): Promise<PpzUser> {
    if (!this.apiKey) throw new Error('PPZ_API_KEY is not configured');
    try {
      const res = await this.http.get<PpzUser>(this.getUserUrl, {
        params: { ppzid },
        headers: this.headers(),
      });
      return res.data;
    } catch (e) {
      throw this.wrap(e);
    }
  }

  /** Convenience used by /api/points/balance. */
  async getBalance(
    ppzid: string,
  ): Promise<{ balance: number; lifetime: number } | { notConfigured: true }> {
    if (!this.apiKey) return { notConfigured: true };
    const u = await this.getUser(ppzid);
    return { balance: u.ppzcurrency, lifetime: u.lifetimeppzcurrency };
  }

  async deduct(input: {
    ppzid: string;
    amount: number;
    reason: string;
  }): Promise<PpzUpdateResult | { notConfigured: true }> {
    if (!this.apiKey) return { notConfigured: true };
    try {
      const res = await this.http.patch<PpzUpdateResult>(
        this.updatePpzUrl,
        {
          ppzid: input.ppzid,
          operation: 'deduct',
          amount: input.amount,
          reason: input.reason,
        },
        { headers: this.headers() },
      );
      return res.data;
    } catch (e) {
      throw this.wrap(e);
    }
  }

  async add(input: {
    ppzid: string;
    amount: number;
    reason: string;
  }): Promise<PpzUpdateResult | { notConfigured: true }> {
    if (!this.apiKey) return { notConfigured: true };
    try {
      const res = await this.http.patch<PpzUpdateResult>(
        this.updatePpzUrl,
        {
          ppzid: input.ppzid,
          operation: 'add',
          amount: input.amount,
          reason: input.reason,
        },
        { headers: this.headers() },
      );
      return res.data;
    } catch (e) {
      throw this.wrap(e);
    }
  }

  /** Surfaces 401 / 404 / 400 distinctly so callers can branch. */
  private wrap(e: unknown): Error & { code?: number } {
    const ax = e as AxiosError<any>;
    const code = ax?.response?.status;
    const msg =
      (ax?.response?.data && (ax.response.data.message || ax.response.data.error)) ||
      ax?.message ||
      'PPZ API request failed';
    const err = new Error(`PPZ API ${code ?? ''}: ${msg}`.trim()) as Error & {
      code?: number;
    };
    err.code = code;
    this.logger.warn(err.message);
    return err;
  }
}
