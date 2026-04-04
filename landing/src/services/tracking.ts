import type { Request } from 'express';
import crypto from 'crypto';
import { UAParser } from 'ua-parser-js';
import geoip from 'geoip-lite';

// Datos capturados de forma pasiva (sin JS, sin permisos del browser).
// Todo proviene del query string + headers HTTP + lookup offline de IP.
export interface TrackingData {
  // Atribución
  source: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  gclid: string | null;
  fbclid: string | null;
  raw_query: string | null;

  // Red
  ip: string | null;
  ip_chain: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  timezone: string | null;
  lat: number | null;
  lon: number | null;

  // Cliente
  user_agent: string | null;
  browser_name: string | null;
  browser_version: string | null;
  os_name: string | null;
  os_version: string | null;
  device_type: string | null;
  device_vendor: string | null;
  device_model: string | null;
  engine_name: string | null;
  is_bot: boolean;
  language: string | null;

  // Client Hints
  ch_ua: string | null;
  ch_ua_mobile: string | null;
  ch_ua_platform: string | null;

  // Privacidad
  dnt: boolean;
  sec_gpc: boolean;

  // Origen
  referer: string | null;
  host: string | null;
  protocol: string | null;

  // Dedupe
  visitor_hash: string | null;
}

function firstString(v: unknown): string | null {
  if (Array.isArray(v)) return typeof v[0] === 'string' ? v[0] : null;
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function header(req: Request, name: string): string | null {
  const v = req.headers[name.toLowerCase()];
  return firstString(v);
}

const BOT_REGEX = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|telegrambot|preview|headless|curl|wget|python-requests|axios|okhttp/i;

export function captureRequestData(req: Request): TrackingData {
  const q = req.query as Record<string, unknown>;

  const source = firstString(q.a) || firstString(q.ref) || firstString(q.source) || 'direct';

  const ua = firstString(req.headers['user-agent']);
  const parsed = ua ? UAParser(ua) : null;
  const isBot = ua ? BOT_REGEX.test(ua) : false;

  // IP: con trust proxy activo, req.ip devuelve la real. Guardamos chain completa por si acaso.
  const ip = req.ip || null;
  const ipChain = firstString(req.headers['x-forwarded-for']);

  // Geo offline (geoip-lite) — no añade latencia ni llamadas externas
  let geo: geoip.Lookup | null = null;
  if (ip) {
    try {
      // geoip-lite no soporta IPv6 local/link; falla silenciosamente
      const clean = ip.replace(/^::ffff:/, '');
      geo = geoip.lookup(clean);
    } catch {
      geo = null;
    }
  }

  // Cloudflare / Railway / proveedor edge pueden darnos el país más confiable que geoip-lite
  const countryHeader =
    header(req, 'cf-ipcountry') ||
    header(req, 'x-vercel-ip-country') ||
    header(req, 'x-country-code');

  const lang = header(req, 'accept-language');
  const primaryLang = lang ? lang.split(',')[0].trim() : null;

  // Hash de visitante (no PII identificable, solo agrupa repeticiones)
  const visitorHash = ip && ua
    ? crypto.createHash('sha256').update(`${ip}|${ua}|${primaryLang ?? ''}`).digest('hex').slice(0, 32)
    : null;

  return {
    source,
    utm_source:   firstString(q.utm_source),
    utm_medium:   firstString(q.utm_medium),
    utm_campaign: firstString(q.utm_campaign),
    utm_content:  firstString(q.utm_content),
    utm_term:     firstString(q.utm_term),
    gclid:        firstString(q.gclid),
    fbclid:       firstString(q.fbclid),
    raw_query:    req.originalUrl.includes('?') ? req.originalUrl.split('?')[1] : null,

    ip,
    ip_chain: ipChain,
    country:  countryHeader || geo?.country || null,
    region:   geo?.region || null,
    city:     geo?.city || null,
    timezone: geo?.timezone || null,
    lat:      geo?.ll?.[0] ?? null,
    lon:      geo?.ll?.[1] ?? null,

    user_agent:      ua,
    browser_name:    parsed?.browser.name || null,
    browser_version: parsed?.browser.version || null,
    os_name:         parsed?.os.name || null,
    os_version:      parsed?.os.version || null,
    device_type:     parsed?.device.type || (isBot ? 'bot' : 'desktop'),
    device_vendor:   parsed?.device.vendor || null,
    device_model:    parsed?.device.model || null,
    engine_name:     parsed?.engine.name || null,
    is_bot:          isBot,
    language:        primaryLang,

    ch_ua:          header(req, 'sec-ch-ua'),
    ch_ua_mobile:   header(req, 'sec-ch-ua-mobile'),
    ch_ua_platform: header(req, 'sec-ch-ua-platform'),

    dnt:     header(req, 'dnt') === '1',
    sec_gpc: header(req, 'sec-gpc') === '1',

    referer:  header(req, 'referer'),
    host:     header(req, 'host'),
    protocol: req.protocol || null,

    visitor_hash: visitorHash,
  };
}
