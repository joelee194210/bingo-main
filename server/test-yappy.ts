/**
 * Script standalone para probar el YappyClient contra UAT.
 *
 * Uso:
 *   cd server
 *   npx tsx test-yappy.ts                          # solo login (prueba credenciales)
 *   npx tsx test-yappy.ts ZLTXD-09223576           # login + detalle de transacción
 *
 * Lee credenciales de server/.env. No toca la base de datos ni el server HTTP.
 */

import 'dotenv/config';
import { getYappyClient } from './src/services/yappyService.js';

async function main(): Promise<void> {
  // 1. Validar config
  const required = ['YAPPY_API_KEY', 'YAPPY_SECRET_KEY', 'YAPPY_SEED_CODE'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error('❌ Faltan variables en .env:', missing.join(', '));
    process.exit(1);
  }

  const baseUrl = process.env.YAPPY_BASE_URL || 'https://api-comecom-uat.yappycloud.com';
  console.log('🔧 Ambiente:', baseUrl);
  console.log('🔧 API Key (últimos 6):', (process.env.YAPPY_API_KEY || '').slice(-6));
  console.log('🔧 Seed (primeros 5):', (process.env.YAPPY_SEED_CODE || '').slice(0, 5));
  console.log('');

  const yappy = getYappyClient();

  // 2. Login
  console.log('▶️  Ejecutando login...');
  try {
    const token = await yappy.login();
    console.log('✅ Login OK. Token (primeros 40):', token.slice(0, 40) + '...');
    console.log('');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('❌ Login falló:', msg);
    process.exit(1);
  }

  // 3. Detalle de transacción (si se pasó argumento)
  const transactionId = process.argv[2];
  if (!transactionId) {
    console.log('ℹ️  Para probar el detalle, corré:');
    console.log('   npx tsx test-yappy.ts <TRANSACTION_ID>');
    console.log('   Ejemplo: npx tsx test-yappy.ts ZLTXD-09223576');
    return;
  }

  console.log(`▶️  Consultando detalle de transacción: ${transactionId}`);
  try {
    const txn = await yappy.getTransactionDetail(transactionId);
    if (!txn) {
      console.log('⚠️  No se encontró la transacción (YP-0001).');
      return;
    }
    console.log('✅ Detalle obtenido:');
    console.log(JSON.stringify(txn, null, 2));
    console.log('');
    console.log('📊 Resumen:');
    console.log('   ID:       ', txn.id);
    console.log('   Estado:   ', txn.status);
    console.log('   Monto:    ', txn.charge?.amount, txn.charge?.currency);
    console.log('   Pagador:  ', txn.debitor?.complete_name, `(${txn.debitor?.alias})`);
    console.log('   Fecha:    ', txn.payment_date);
    console.log('   Descr:    ', txn.description);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('❌ Consulta falló:', msg);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('❌ Error fatal:', err);
  process.exit(1);
});
