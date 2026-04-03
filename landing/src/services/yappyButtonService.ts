import { createHmac } from 'crypto';

interface YappyButtonConfig {
  merchantId: string;
  secretToken: string;
  successUrl: string;
  failUrl: string;
  domainUrl: string;
  checkoutUrl: string;
  sandbox: boolean;
}

interface PaymentRequest {
  orderId: string;
  total: number;
  subtotal: number;
  taxes: number;
}

interface PaymentUrlResult {
  redirectUrl: string;
  success: boolean;
}

interface YappyCallbackParams {
  orderId?: string;
  status?: string;         // E = ejecutado, R = rechazado, C = cancelado
  confirmationNumber?: string;
  hash?: string;
}

export class YappyButtonClient {
  private config: YappyButtonConfig;
  private merchantSecret: string; // parte después del '.' en secretToken decodificado
  private signingKey: string;     // parte antes del '.' en secretToken decodificado

  constructor() {
    this.config = {
      merchantId: process.env.YAPPY_BTN_MERCHANT_ID || '',
      secretToken: process.env.YAPPY_BTN_SECRET_TOKEN || '',
      successUrl: process.env.YAPPY_BTN_SUCCESS_URL || '',
      failUrl: process.env.YAPPY_BTN_FAIL_URL || '',
      domainUrl: process.env.YAPPY_BTN_DOMAIN || '',
      checkoutUrl: process.env.YAPPY_BTN_CHECKOUT_URL || '',
      sandbox: process.env.YAPPY_BTN_SANDBOX === 'true',
    };

    // Decodificar secretToken: base64 → "signingKey.merchantSecret"
    const decoded = Buffer.from(this.config.secretToken, 'base64').toString('utf-8');
    const parts = decoded.split('.');
    this.signingKey = parts[0] || '';
    this.merchantSecret = parts[1] || '';
  }

  /**
   * Paso 1: Obtener JWT token de Yappy
   */
  private async getJwtToken(): Promise<string> {
    const res = await fetch('https://pagosbg.bgeneral.com/validateapikeymerchand', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.merchantSecret,
        'version': 'P1.0.0',
      },
      body: JSON.stringify({
        merchantId: this.config.merchantId,
        urlDomain: this.config.domainUrl,
      }),
    });

    const data = await res.json() as { success?: boolean; accessToken?: string; message?: string };

    if (!data.success || !data.accessToken) {
      console.error('Yappy JWT error:', data);
      throw new Error(`Error obteniendo token de Yappy: ${data.message || 'unknown'}`);
    }

    return data.accessToken;
  }

  /**
   * Paso 2: Generar firma HMAC-SHA256 y construir URL de pago
   */
  private buildRedirectUrl(jwtToken: string, payment: PaymentRequest, paymentDate: number): string {
    const { merchantId, successUrl, failUrl, domainUrl, checkoutUrl, sandbox } = this.config;

    // Concatenar campos en orden exacto para la firma
    const signatureInput =
      payment.total.toFixed(2) +
      merchantId +
      payment.subtotal.toFixed(2) +
      payment.taxes.toFixed(2) +
      paymentDate.toString() +
      'YAP' +
      'VEN' +
      payment.orderId +
      successUrl +
      failUrl +
      domainUrl;

    const signature = createHmac('sha256', this.signingKey)
      .update(signatureInput)
      .digest('hex');

    const params = new URLSearchParams({
      sbx: sandbox ? 'yes' : 'no',
      donation: 'no',
      checkoutUrl,
      signature,
      merchantId,
      total: payment.total.toFixed(2),
      subtotal: payment.subtotal.toFixed(2),
      taxes: payment.taxes.toFixed(2),
      paymentDate: paymentDate.toString(),
      paymentMethod: 'YAP',
      transactionType: 'VEN',
      orderId: payment.orderId,
      successUrl,
      failUrl,
      domain: domainUrl,
      aliasYappy: '',
      platform: 'desarrollopropiophp',
      jwtToken,
    });

    return `https://pagosbg.bgeneral.com?${params.toString()}`;
  }

  /**
   * Genera URL de pago completa (JWT + firma + redirect URL)
   */
  async getPaymentUrl(payment: PaymentRequest): Promise<PaymentUrlResult> {
    try {
      const jwtToken = await this.getJwtToken();
      const paymentDate = Date.now();
      const redirectUrl = this.buildRedirectUrl(jwtToken, payment, paymentDate);

      return { redirectUrl, success: true };
    } catch (err) {
      console.error('Error generando URL de pago Yappy:', err);
      return { redirectUrl: '', success: false };
    }
  }

  /**
   * Valida los parámetros del callback de Yappy
   */
  validateCallback(params: YappyCallbackParams): {
    valid: boolean;
    orderId: string;
    status: 'completed' | 'rejected' | 'cancelled';
    confirmationNumber: string;
  } {
    const { orderId, status, confirmationNumber } = params;

    if (!orderId || !status) {
      return { valid: false, orderId: '', status: 'rejected', confirmationNumber: '' };
    }

    const statusMap: Record<string, 'completed' | 'rejected' | 'cancelled'> = {
      'E': 'completed',
      'R': 'rejected',
      'C': 'cancelled',
    };

    return {
      valid: true,
      orderId,
      status: statusMap[status] || 'rejected',
      confirmationNumber: confirmationNumber || '',
    };
  }

  isConfigured(): boolean {
    return !!(this.config.merchantId && this.config.secretToken && this.config.domainUrl);
  }
}

// Singleton
let buttonClient: YappyButtonClient | null = null;

export function getYappyButtonClient(): YappyButtonClient {
  if (!buttonClient) {
    buttonClient = new YappyButtonClient();
  }
  return buttonClient;
}
