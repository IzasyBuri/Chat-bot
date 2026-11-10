import { WEBHOOK_SECRET_MIN_LENGTH } from './openwa-contract';

export interface RuntimeConfig {
  isProduction: boolean;
  appOrigins: string[];
  cookieSecure: boolean;
  gatewayUrl: string;
  webhookSecret: string;
  webhookUrl: string;
}

const splitOrigins = (value: string | undefined): string[] => (value ?? '').split(',').map(v => v.trim()).filter(Boolean);

export function loadConfig(env: NodeJS.ProcessEnv): RuntimeConfig {
  const isProduction = env.NODE_ENV === 'production';
  const appOrigins = splitOrigins(env.APP_ORIGIN);
  const cookieSecure = env.COOKIE_SECURE === 'true';
  const webhookSecret = env.OPENWA_WEBHOOK_SECRET ?? '';
  const webhookUrl = env.OPENWA_WEBHOOK_URL ?? '';
  const gatewayUrl = env.OPENWA_URL || 'http://127.0.0.1:2785';

  if (isProduction) {
    if (!appOrigins.length) throw new Error('APP_ORIGIN wajib diisi di produksi.');
    if (appOrigins.some(origin => !origin.startsWith('https://'))) throw new Error('APP_ORIGIN wajib HTTPS di produksi.');
    if (!cookieSecure) throw new Error('COOKIE_SECURE=true wajib di produksi dengan HTTPS.');
    if (webhookSecret.length < WEBHOOK_SECRET_MIN_LENGTH) throw new Error(`OPENWA_WEBHOOK_SECRET wajib minimal ${WEBHOOK_SECRET_MIN_LENGTH} karakter di produksi.`);
  }

  return { isProduction, appOrigins: appOrigins.length ? appOrigins : ['http://localhost:5173'], cookieSecure, gatewayUrl, webhookSecret, webhookUrl };
}
