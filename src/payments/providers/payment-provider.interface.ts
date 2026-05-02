export interface PaymentInitInput {
  orderId: string;
  orderNumber: string;
  amountCents: number;
  currency: string;
  customerEmail?: string;
  customerName?: string;
  description?: string;
  successUrl?: string;
  cancelUrl?: string;
  metadata?: Record<string, string>;
}

export interface PaymentInitResult {
  provider: string;
  reference: string; // intent / session id
  checkoutUrl?: string; // hosted checkout if any
  clientSecret?: string; // for client-side confirmation
  status: 'requires_action' | 'pending' | 'succeeded' | 'failed';
  raw?: any;
}

export interface PaymentWebhookEvent {
  type: string;
  reference: string;
  orderId?: string;
  succeeded: boolean;
  raw: any;
}

export interface PaymentProvider {
  readonly name: string;
  init(input: PaymentInitInput): Promise<PaymentInitResult>;
  parseWebhook(rawBody: Buffer | string, headers: Record<string, any>): Promise<PaymentWebhookEvent>;
  /**
   * Best-effort cancel for an in-flight intent (used by the Cancel
   * Order flow on `awaiting_payment` orders). Returns true if the
   * provider acknowledged the cancel, false if it was already
   * settled / not cancellable. Implementations should swallow
   * "already cancelled / already succeeded" errors and return false
   * — the caller treats those as benign.
   */
  cancelIntent?(reference: string): Promise<boolean>;
}
