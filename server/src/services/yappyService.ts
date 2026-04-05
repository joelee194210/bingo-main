import { createHmac } from 'crypto';
import { getPool } from '../database/init.js';
import { confirmPayment } from './onlineOrderService.js';

interface YappyConfig {
  apiKey: string;
  secretKey: string;
  seedCode: string;
  baseUrl: string;
  channel: string;
}

interface YappyTransaction {
  id: string;
  number?: string;
  registration_date?: string;
  payment_date?: string;
  type?: string;
  category?: string;
  charge?: {
    amount: number;
    currency: string;
  };
  description?: string;
  bill_description?: string;
  status?: string;
  debitor?: { alias?: string; complete_name?: string };
  creditor?: { alias?: string; complete_name?: string };
}

export class YappyClient {
  private token: string | null = null;
  private tokenExpiry: Date | null = null;
  private config: YappyConfig;

  constructor() {
    this.config = {
      apiKey: process.env.YAPPY_API_KEY || '',
      secretKey: process.env.YAPPY_SECRET_KEY || '',
      seedCode: process.env.YAPPY_SEED_CODE || '',
      baseUrl: process.env.YAPPY_BASE_URL || 'https://api-comecom-uat.yappycloud.com',
      channel: process.env.YAPPY_CHANNEL || 'WEB',
    };
  }

  private generateCode(): string {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const data = this.config.apiKey + today;
    return createHmac('sha256', this.config.seedCode).update(data).digest('hex');
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    if (!this.token) await this.login();

    const url = this.config.baseUrl + path;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'api-key': this.config.apiKey,
      'secret-key': this.config.secretKey,
      'authorization': `Bearer ${this.token}`,
      'Client-Ip': '127.0.0.1',
      'Channel': this.config.channel,
    };

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await res.json() as Record<string, unknown>;

    if (!res.ok) {
      console.error('Yappy API error:', data);
      throw new Error(`Yappy API error: ${res.status} ${JSON.stringify(data)}`);
    }

    return data;
  }

  async login(): Promise<string> {
    const code = this.generateCode();
    const url = this.config.baseUrl + '/v1/session/login';

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': this.config.apiKey,
        'secret-key': this.config.secretKey,
        'Client-Ip': '127.0.0.1',
        'Channel': this.config.channel,
      },
      body: JSON.stringify({ body: { code } }),
    });

    const data = await res.json() as {
      body?: { token?: { token?: string }; state?: string };
      status?: { code?: string; description?: string };
    };

    if (data.status?.code !== 'YP-0000' || !data.body?.token?.token) {
      throw new Error(`Yappy login failed: ${JSON.stringify(data.status)}`);
    }

    this.token = data.body.token.token;
    // Token dura aprox 24h, renovar cada 23h
    this.tokenExpiry = new Date(Date.now() + 23 * 60 * 60 * 1000);

    console.log('✅ Yappy session abierta');
    return this.token;
  }

  async getTransactionHistory(startDate: string, endDate: string): Promise<YappyTransaction[]> {
    const allTransactions: YappyTransaction[] = [];
    let hasNextPage = true;
    let paymentDate: string | null = null;

    while (hasNextPage) {
      const body: Record<string, unknown> = {
        body: {
          pagination: {
            start_date: startDate,
            end_date: endDate,
            limit: 50,
            ...(paymentDate ? { payment_date: paymentDate } : {}),
          },
          filter: [{ id: 'ROLE', value: 'CREDIT' }],
        },
      };

      const data = await this.request('POST', '/v1/movement/history', body) as {
        body?: {
          pagination?: { has_next_page?: boolean; payment_date?: string };
          transactions?: YappyTransaction[];
        };
        status?: { code?: string };
      };

      if (data.status?.code === 'YP-0001') break; // No data
      if (data.body?.transactions) {
        allTransactions.push(...data.body.transactions);
      }

      hasNextPage = data.body?.pagination?.has_next_page ?? false;
      paymentDate = data.body?.pagination?.payment_date ?? null;
    }

    return allTransactions;
  }

  async matchPendingOrders(): Promise<number> {
    try {
      // Verificar si hay órdenes pendientes
      const pool = getPool();
      const { rows: pendingOrders } = await pool.query<{
        id: number;
        order_code: string;
        total_amount: number;
      }>(
        `SELECT id, order_code, total_amount FROM online_orders
         WHERE status = 'pending_payment' AND expires_at > NOW()`
      );

      if (pendingOrders.length === 0) return 0;

      // Renovar token si expiro
      if (!this.token || (this.tokenExpiry && new Date() > this.tokenExpiry)) {
        await this.login();
      }

      const today = new Date().toISOString().split('T')[0];
      const transactions = await this.getTransactionHistory(today, today);

      let matched = 0;
      for (const txn of transactions) {
        if (txn.status !== 'COMPLETED') continue;

        // Buscar order_code en la descripción de la transacción
        const description = (txn.description || '') + ' ' + (txn.bill_description || '');
        for (const order of pendingOrders) {
          if (
            description.toUpperCase().includes(order.order_code) &&
            txn.charge?.amount === Number(order.total_amount)
          ) {
            // SEC-H8: no loguear txn.id completo (es el token de replay attack);
            // enmascarar dejando solo prefijo para correlación.
            const maskedTxn = txn.id ? `${String(txn.id).slice(0, 6)}…` : '?';
            console.log(`[Yappy] match: ${order.order_code} → txn ${maskedTxn}`);
            await confirmPayment(order.id, 'auto', txn.id, txn as unknown as Record<string, unknown>);
            matched++;
            break;
          }
        }
      }

      return matched;
    } catch (err) {
      console.error('Error en Yappy polling:', err);
      return 0;
    }
  }
}

// Singleton
let yappyClient: YappyClient | null = null;

export function getYappyClient(): YappyClient {
  if (!yappyClient) {
    yappyClient = new YappyClient();
  }
  return yappyClient;
}
