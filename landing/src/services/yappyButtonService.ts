import { createHmac } from 'crypto';

/**
 * Yappy Botón de Pago V2
 *
 * Flujo:
 * 1. POST /payments/validate/merchant → obtiene token + epochTime
 * 2. POST /payments/payment-wc → crea orden, obtiene transactionId + token + documentName
 * 3. Frontend: <btn-yappy> web component ejecuta eventPayment(params)
 * 4. IPN: Yappy llama GET a ipnUrl con orderId, status, Hash, domain
 */

interface YappyV2Config {
  merchantId: string;
  secretToken: string;  // base64 encoded: "signingKey.merchantSecret"
  domainUrl: string;
  ipnUrl: string;
  baseUrl: string;      // https://apipagosbg.bgeneral.cloud o UAT
  sandbox: boolean;
}

interface CreateOrderRequest {
  orderId: string;
  total: number;
  subtotal: number;
  taxes: number;
  discount?: number;
  tel?: string;
}

interface ValidateMerchantResponse {
  status: { code: string; description: string };
  body: { epochTime: number; token: string };
}

interface CreateOrderResponse {
  status: { code: string; description: string };
  body: { transactionId: string; token: string; documentName: string };
}

export interface PaymentParams {
  transactionId: string;
  token: string;
  documentName: string;
}

export class YappyButtonClient {
  private config: YappyV2Config;
  private signingKey: string;

  constructor() {
    const sandbox = process.env.YAPPY_BTN_SANDBOX === 'true';
    this.config = {
      merchantId: process.env.YAPPY_BTN_MERCHANT_ID || '',
      secretToken: process.env.YAPPY_BTN_SECRET_TOKEN || '',
      domainUrl: process.env.YAPPY_BTN_DOMAIN || '',
      ipnUrl: process.env.YAPPY_BTN_IPN_URL || '',
      baseUrl: sandbox
        ? 'https://api-comecom-uat.yappycloud.com'
        : 'https://apipagosbg.bgeneral.cloud',
      sandbox,
    };

    // Decodificar secretToken: base64 → "signingKey.merchantSecret"
    const decoded = Buffer.from(this.config.secretToken, 'base64').toString('utf-8');
    const parts = decoded.split('.');
    this.signingKey = parts[0] || '';
  }

  /**
   * Paso 1: Validar comercio → obtiene token de sesión
   * POST /payments/validate/merchant
   */
  async validateMerchant(): Promise<{ token: string; epochTime: number }> {
    const url = `${this.config.baseUrl}/payments/validate/merchant`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merchantId: this.config.merchantId,
        urlDomain: this.config.domainUrl,
      }),
    });

    const data = await res.json() as ValidateMerchantResponse;

    if (data.status?.code !== 'YP-0000' || !data.body?.token) {
      console.error('Yappy validate/merchant error:', JSON.stringify(data));
      throw new Error(`Error validando comercio: ${data.status?.description || res.status}`);
    }

    return { token: data.body.token, epochTime: data.body.epochTime };
  }

  /**
   * Paso 2: Crear orden de pago
   * POST /payments/payment-wc
   */
  async createPaymentOrder(
    authToken: string,
    order: CreateOrderRequest
  ): Promise<PaymentParams> {
    const url = `${this.config.baseUrl}/payments/payment-wc`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authToken,
      },
      body: JSON.stringify({
        merchantId: this.config.merchantId,
        orderId: order.orderId,
        domain: this.config.domainUrl,
        paymentDate: Date.now().toString(),
        aliasYappy: order.tel || '',
        ipnUrl: this.config.ipnUrl,
        discount: (order.discount ?? 0).toFixed(2),
        taxes: order.taxes.toFixed(2),
        subtotal: order.subtotal.toFixed(2),
        total: order.total.toFixed(2),
      }),
    });

    const data = await res.json() as CreateOrderResponse;

    if (data.status?.code !== 'YP-0000' || !data.body?.transactionId) {
      console.error('Yappy payment-wc error:', JSON.stringify(data));
      throw new Error(`Error creando orden Yappy: ${data.status?.description || res.status}`);
    }

    return {
      transactionId: data.body.transactionId,
      token: data.body.token,
      documentName: data.body.documentName,
    };
  }

  /**
   * Flujo completo: validate merchant + create order
   */
  async initiatePayment(order: CreateOrderRequest): Promise<PaymentParams> {
    const { token } = await this.validateMerchant();
    return this.createPaymentOrder(token, order);
  }

  /**
   * Valida el hash del IPN (webhook) de Yappy
   * Hash = HMAC-SHA256(orderId + status + domain, signingKey)
   */
  validateIPN(params: {
    orderId?: string;
    status?: string;
    Hash?: string;
    domain?: string;
  }): { valid: boolean; orderId: string; status: 'completed' | 'rejected' | 'cancelled' | 'expired' } {
    const { orderId, status, Hash, domain } = params;

    if (!orderId || !status) {
      return { valid: false, orderId: '', status: 'rejected' };
    }

    // Verificar hash
    if (Hash && this.signingKey) {
      const expected = createHmac('sha256', this.signingKey)
        .update(orderId + status + domain)
        .digest('hex');

      if (Hash !== expected) {
        console.error(`IPN hash mismatch: expected=${expected}, got=${Hash}`);
        return { valid: false, orderId, status: 'rejected' };
      }
    }

    const statusMap: Record<string, 'completed' | 'rejected' | 'cancelled' | 'expired'> = {
      'E': 'completed',
      'R': 'rejected',
      'C': 'cancelled',
      'X': 'expired',
    };

    return {
      valid: true,
      orderId,
      status: statusMap[status] || 'rejected',
    };
  }

  isConfigured(): boolean {
    return !!(this.config.merchantId && this.config.secretToken && this.config.domainUrl);
  }

  get cdnUrl(): string {
    return this.config.sandbox
      ? 'https://bt-cdn-uat.yappycloud.com/v1/cdn/web-component-btn-yappy.js'
      : 'https://bt-cdn.yappy.cloud/v1/cdn/web-component-btn-yappy.js';
  }

  get domain(): string {
    return this.config.domainUrl;
  }
}

// Singleton
let client: YappyButtonClient | null = null;

export function getYappyButtonClient(): YappyButtonClient {
  if (!client) {
    client = new YappyButtonClient();
  }
  return client;
}
