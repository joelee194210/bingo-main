import { useState, useEffect, useRef, useCallback, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/* ─── Floating bingo balls ─── */
const FLOATING_BALLS = [
  // Pegadas al formulario — izquierda
  { n: 7, letter: 'B', x: 22, y: 25, size: 50, dur: 18, del: 0, hue: '217 91% 60%' },
  { n: 28, letter: 'I', x: 18, y: 50, size: 44, dur: 20, del: 1, hue: '280 70% 55%' },
  { n: 46, letter: 'G', x: 20, y: 72, size: 36, dur: 21, del: 8, hue: '45 93% 47%' },
  // Pegadas al formulario — derecha
  { n: 44, letter: 'N', x: 72, y: 20, size: 48, dur: 22, del: 2, hue: '142 71% 45%' },
  { n: 59, letter: 'G', x: 74, y: 48, size: 42, dur: 23, del: 3, hue: '45 93% 47%' },
  { n: 19, letter: 'I', x: 70, y: 72, size: 46, dur: 16, del: 1, hue: '0 72% 51%' },
  // Arriba del formulario
  { n: 38, letter: 'N', x: 35, y: 10, size: 34, dur: 25, del: 7, hue: '142 71% 45%' },
  { n: 67, letter: 'O', x: 55, y: 8, size: 38, dur: 18, del: 2, hue: '210 90% 55%' },
  // Abajo del formulario
  { n: 51, letter: 'G', x: 40, y: 88, size: 32, dur: 24, del: 3, hue: '217 91% 60%' },
  { n: 3, letter: 'B', x: 58, y: 90, size: 30, dur: 21, del: 6, hue: '0 72% 51%' },
  // Esquinas cercanas
  { n: 62, letter: 'O', x: 15, y: 15, size: 28, dur: 20, del: 4, hue: '210 90% 55%' },
  { n: 71, letter: 'O', x: 80, y: 12, size: 32, dur: 17, del: 2, hue: '142 71% 45%' },
  { n: 33, letter: 'N', x: 80, y: 85, size: 30, dur: 19, del: 5, hue: '280 70% 55%' },
  { n: 14, letter: 'B', x: 15, y: 88, size: 34, dur: 19, del: 4, hue: '217 91% 60%' },
  { n: 11, letter: 'B', x: 25, y: 38, size: 26, dur: 22, del: 5, hue: '0 72% 51%' },
];

function FloatingBall({ n, letter, x, y, size, dur, del, hue }: typeof FLOATING_BALLS[0]) {
  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: `${x}%`,
        top: `${y}%`,
        width: size,
        height: size,
        animation: `login-float ${dur}s ease-in-out ${del}s infinite alternate`,
      }}
    >
      <div
        className="w-full h-full rounded-full relative"
        style={{
          background: `radial-gradient(circle at 35% 30%, hsl(${hue} / 0.7), hsl(${hue} / 0.4) 60%, hsl(${hue} / 0.15))`,
          boxShadow: `0 0 ${size * 0.4}px hsl(${hue} / 0.1)`,
        }}
      >
        <div
          className="absolute rounded-full bg-white/90 flex flex-col items-center justify-center"
          style={{ inset: size * 0.15 }}
        >
          <span className="font-black leading-none text-slate-500" style={{ fontSize: size * 0.15 }}>{letter}</span>
          <span className="font-black leading-none text-slate-800" style={{ fontSize: size * 0.28 }}>{n}</span>
        </div>
      </div>
    </div>
  );
}

/* ─── Main Login ─── */
export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [captchaEnabled, setCaptchaEnabled] = useState<boolean | null>(null);
  const [captchaSiteKey, setCaptchaSiteKey] = useState<string | null>(null);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/';

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(t);
  }, []);

  // Consultar si captcha esta habilitado
  useEffect(() => {
    fetch('/api/auth/config')
      .then(r => r.json())
      .then(d => {
        setCaptchaEnabled(d.data?.captchaEnabled ?? false);
        setCaptchaSiteKey(d.data?.captchaSiteKey ?? null);
      })
      .catch(() => setCaptchaEnabled(false));
  }, []);

  // Cargar Turnstile script solo si captcha esta habilitado
  useEffect(() => {
    if (!captchaEnabled || !captchaSiteKey) return;
    if (document.getElementById('cf-turnstile-script')) {
      // Script ya cargado (ej: navegacion SPA), solo renderizar
      renderTurnstile();
      return;
    }
    const script = document.createElement('script');
    script.id = 'cf-turnstile-script';
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => renderTurnstile();
    document.head.appendChild(script);
  }, [captchaEnabled, captchaSiteKey]);

  const renderTurnstile = useCallback(() => {
    if (!captchaSiteKey) return;
    const w = window as unknown as { turnstile?: { render: (el: HTMLElement, opts: Record<string, unknown>) => string; reset: (id: string) => void } };
    if (!w.turnstile || !turnstileRef.current) {
      setTimeout(renderTurnstile, 200);
      return;
    }
    if (widgetIdRef.current) return;
    widgetIdRef.current = w.turnstile.render(turnstileRef.current, {
      sitekey: captchaSiteKey,
      theme: 'light',
      callback: (token: string) => setTurnstileToken(token),
      'expired-callback': () => setTurnstileToken(null),
      'error-callback': () => setTurnstileToken(null),
    });
  }, [captchaSiteKey]);

  useEffect(() => { renderTurnstile(); }, [renderTurnstile]);

  const resetTurnstile = () => {
    const w = window as unknown as { turnstile?: { reset: (id: string) => void } };
    if (w.turnstile && widgetIdRef.current) {
      w.turnstile.reset(widgetIdRef.current);
      setTurnstileToken(null);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (captchaEnabled && !turnstileToken) {
      setError('Complete la verificacion de seguridad');
      return;
    }

    setIsLoading(true);

    try {
      const user = await login(username, password, turnstileToken || undefined);
      if (user) {
        const destination = user.role === 'inventory' ? '/inventory' : from;
        navigate(destination, { replace: true });
      } else {
        setError('Usuario o contrasena incorrectos');
        if (captchaEnabled) resetTurnstile();
      }
    } catch {
      setError('Error al iniciar sesion. Intente de nuevo.');
      if (captchaEnabled) resetTurnstile();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-white select-none relative overflow-hidden">
      {/* Floating bingo balls */}
      <div className="absolute inset-0 overflow-hidden">
        {FLOATING_BALLS.map((ball) => (
          <FloatingBall key={`${ball.letter}${ball.n}`} {...ball} />
        ))}
      </div>

      <div
        className={`w-full max-w-[400px] mx-4 transition-all duration-700 ease-out ${
          mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
        }`}
      >
        {/* Logo */}
        <div className="text-center mb-8">
          <img src="/logo.png" alt="Logo" className="h-32 mx-auto mb-4 object-contain" />
        </div>

        {/* Form card */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-lg overflow-hidden">
          <div className="p-6 sm:p-8">
            <h2 className="text-[17px] font-semibold text-slate-900 mb-1">Iniciar Sesion</h2>
            <p className="text-slate-500 text-sm mb-6">Ingrese sus credenciales para continuar</p>

            {/* Error */}
            {error && (
              <div className="mb-5 p-3 rounded-xl flex items-center gap-3 bg-red-50 border border-red-200">
                <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                <span className="text-red-600 text-sm">{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Username */}
              <div className="space-y-1.5">
                <label htmlFor="username" className="text-slate-600 text-xs font-medium tracking-wide uppercase block">
                  Usuario
                </label>
                <Input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Ingrese su usuario"
                  required
                  autoComplete="username"
                  autoFocus
                  className="h-11 rounded-xl text-[15px]"
                />
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <label htmlFor="password" className="text-slate-600 text-xs font-medium tracking-wide uppercase block">
                  Contrasena
                </label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Ingrese su contrasena"
                  required
                  autoComplete="off"
                  className="h-11 rounded-xl text-[15px]"
                />
              </div>

              {/* Turnstile CAPTCHA */}
              {captchaEnabled && <div ref={turnstileRef} className="flex justify-center" />}

              {/* Submit */}
              <div className="pt-1">
                <Button
                  type="submit"
                  disabled={isLoading}
                  className="w-full h-11 rounded-xl text-[15px] font-semibold"
                  size="lg"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Iniciando sesion...
                    </>
                  ) : (
                    'Iniciar Sesion'
                  )}
                </Button>
              </div>
            </form>

          </div>
        </div>
      </div>

      <style>{`
        @keyframes login-float {
          0% { transform: translateY(0) rotate(0deg); }
          100% { transform: translateY(-20px) rotate(6deg); }
        }
      `}</style>
    </div>
  );
}
