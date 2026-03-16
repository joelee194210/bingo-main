# QR Verificación Pública — Diseño de URL

## URL Definida

```
https://verificatubingo.com/verificar/{card_code}
```

Ejemplo: `https://verificatubingo.com/verificar/A7X2K`

## Dos Consumidores, Mismo QR

### 1. Persona en la calle (navegador)
- Escanea el QR → abre la URL en el navegador
- Ve una página pública con:
  - Evento al que pertenece el cartón
  - Números del cartón
  - Estado (vendido / no vendido / activo)
- **NO** se muestra el `validation_code` (secreto del raspadito)

### 2. Vendedor (app interna)
- Escanea el QR → la app extrae el `card_code` del URL
- No abre navegador, solo parsea: `url.split('/').pop()` → `A7X2K`
- Busca el cartón internamente por `card_code`
- El vendedor ve el serial (`000001-01`) en su interfaz como siempre

## ¿Por qué `card_code` y no `serial` ni `validation_code`?

| Campo | Valor ejemplo | En el QR | Razón |
|---|---|---|---|
| `card_code` | `A7X2K` | **SI** | Público, único, no predecible, 5 chars (QR compacto) |
| `serial` | `000001-01` | NO | Secuencial y predecible, alguien podría iterar |
| `validation_code` | `M3R9P` | NO | Es el secreto del raspadito, exponerlo compromete la seguridad |
| `card_number` | `1, 2, 3...` | NO | Secuencial por evento, no es único global |

## Seguridad

- El `card_code` es público por diseño (impreso visiblemente en el cartón)
- El `validation_code` permanece oculto (raspadito) y solo se usa para reclamar premios
- Cloudflare protege contra scraping/enumeración a nivel DNS/WAF
- Rate limiting en la API previene abuso de consultas

## Infraestructura

- **Dominio**: `verificatubingo.com`
- **CDN/WAF**: Cloudflare
- **Ruta pública**: `GET /verificar/:card_code` — no requiere autenticación
- **Deep linking**: mismo URL funciona como página web y como identificador parseable para la app
