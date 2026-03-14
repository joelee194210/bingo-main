import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/* ─── Floating bingo balls that drift across the background ─── */
const FLOATING_BALLS = [
  { n: 7, letter: 'B', x: 8, y: 15, size: 56, dur: 18, del: 0, hue: '217 91% 60%' },
  { n: 44, letter: 'N', x: 85, y: 22, size: 48, dur: 22, del: 2, hue: '142 71% 45%' },
  { n: 62, letter: 'O', x: 12, y: 72, size: 42, dur: 20, del: 4, hue: '210 90% 55%' },
  { n: 19, letter: 'I', x: 78, y: 68, size: 52, dur: 16, del: 1, hue: '0 72% 51%' },
  { n: 51, letter: 'G', x: 50, y: 85, size: 38, dur: 24, del: 3, hue: '45 93% 47%' },
  { n: 33, letter: 'N', x: 92, y: 45, size: 34, dur: 19, del: 5, hue: '217 91% 60%' },
  { n: 3, letter: 'B', x: 25, y: 90, size: 30, dur: 21, del: 6, hue: '0 72% 51%' },
  { n: 71, letter: 'O', x: 65, y: 10, size: 36, dur: 17, del: 2, hue: '142 71% 45%' },
];

/* ─── Mini bingo card pattern for background texture ─── */
function BingoCardPattern({ className }: { className?: string }) {
  const cells = Array.from({ length: 25 }, (_, i) => {
    const col = i % 5;
    const row = Math.floor(i / 5);
    const isCenter = i === 12;
    const isFilled = [0, 3, 6, 8, 12, 16, 18, 21, 24].includes(i);
    return { col, row, isCenter, isFilled };
  });

  return (
    <div className={className}>
      <div className="grid grid-cols-5 gap-[2px] w-[120px]">
        {cells.map((cell, i) => (
          <div
            key={i}
            className={`w-[22px] h-[22px] rounded-[3px] border transition-all duration-1000 ${
              cell.isCenter
                ? 'bg-blue-500/20 border-blue-500/30'
                : cell.isFilled
                  ? 'bg-white/[0.06] border-white/[0.08]'
                  : 'bg-transparent border-white/[0.03]'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

/* ─── Animated ball component with 3D depth ─── */
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
          background: `radial-gradient(circle at 35% 30%, hsl(${hue} / 0.9), hsl(${hue} / 0.6) 60%, hsl(${hue} / 0.3))`,
          boxShadow: `0 0 ${size * 0.6}px hsl(${hue} / 0.15), inset 0 -${size * 0.08}px ${size * 0.15}px hsl(${hue} / 0.2)`,
        }}
      >
        {/* Inner white circle — classic bingo ball look */}
        <div
          className="absolute rounded-full bg-white/80 flex flex-col items-center justify-center"
          style={{
            inset: size * 0.15,
          }}
        >
          <span
            className="font-black leading-none text-slate-600"
            style={{ fontSize: size * 0.15 }}
          >
            {letter}
          </span>
          <span
            className="font-black leading-none text-slate-900"
            style={{ fontSize: size * 0.28 }}
          >
            {n}
          </span>
        </div>
        {/* Shine highlight */}
        <div
          className="absolute rounded-full bg-white/30"
          style={{
            width: size * 0.18,
            height: size * 0.12,
            top: size * 0.12,
            left: size * 0.22,
            filter: `blur(${size * 0.04}px)`,
          }}
        />
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

  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/';

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(t);
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const success = await login(username, password);
      if (success) {
        const userStr = localStorage.getItem('bingo_auth_user');
        const userData = userStr ? JSON.parse(userStr) : null;
        const destination = userData?.role === 'inventory' ? '/inventory' : from;
        navigate(destination, { replace: true });
      } else {
        setError('Usuario o contrasena incorrectos');
      }
    } catch {
      setError('Error al iniciar sesion. Intente de nuevo.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden select-none">
      {/* ── Deep blue background ── */}
      <div className="absolute inset-0 bg-[#060f1e]" />

      {/* ── Radial gradient atmosphere ── */}
      <div
        className="absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse 80% 60% at 50% 40%, hsl(217 91% 60% / 0.12) 0%, transparent 70%),
            radial-gradient(ellipse 60% 50% at 20% 80%, hsl(210 90% 50% / 0.08) 0%, transparent 60%),
            radial-gradient(ellipse 50% 40% at 80% 20%, hsl(200 85% 45% / 0.06) 0%, transparent 50%)
          `,
        }}
      />

      {/* ── Dot grid ── */}
      <div
        className="absolute inset-0 opacity-[0.025]"
        style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, white 0.5px, transparent 0)',
          backgroundSize: '24px 24px',
        }}
      />

      {/* ── Floating bingo balls ── */}
      <div className="absolute inset-0 overflow-hidden">
        {FLOATING_BALLS.map((ball) => (
          <FloatingBall key={`${ball.letter}${ball.n}`} {...ball} />
        ))}
      </div>

      {/* ── Decorative bingo card patterns ── */}
      <BingoCardPattern className="absolute top-[12%] left-[6%] opacity-[0.15] rotate-[-12deg] hidden lg:block" />
      <BingoCardPattern className="absolute bottom-[15%] right-[8%] opacity-[0.1] rotate-[8deg] hidden lg:block" />

      {/* ── Horizontal light streak ── */}
      <div
        className="absolute left-0 right-0 h-px top-[38%] opacity-[0.06]"
        style={{
          background: 'linear-gradient(90deg, transparent, hsl(217 91% 60% / 0.8) 30%, hsl(210 90% 50% / 0.6) 70%, transparent)',
        }}
      />

      {/* ── Main card ── */}
      <div
        className={`relative z-10 w-full max-w-[400px] mx-4 transition-all duration-700 ease-out ${
          mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
        }`}
      >
        {/* Header — brand */}
        <div className="text-center mb-8">
          {/* Bingo ball logo */}
          <div className="relative inline-flex mb-4">
            <div
              className="w-[72px] h-[72px] rounded-full relative"
              style={{
                background: 'radial-gradient(circle at 35% 30%, #60a5fa, #2563eb 50%, #1e40af)',
                boxShadow: '0 0 40px rgba(37, 99, 235, 0.4), 0 0 80px rgba(37, 99, 235, 0.15), inset 0 -4px 8px rgba(30, 64, 175, 0.4)',
              }}
            >
              <div className="absolute inset-[10px] rounded-full bg-white/90 flex items-center justify-center">
                <span
                  className="font-black text-[28px] leading-none"
                  style={{
                    background: 'linear-gradient(135deg, #1e40af, #3b82f6)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  }}
                >
                  B
                </span>
              </div>
              {/* Shine */}
              <div className="absolute w-5 h-3 bg-white/35 rounded-full top-3 left-4 blur-[2px]" />
            </div>
            {/* Pulsing ring */}
            <div className="absolute inset-0 rounded-full animate-ping opacity-20 bg-blue-500/30" style={{ animationDuration: '3s' }} />
          </div>

          <h1 className="text-[28px] sm:text-[32px] font-extrabold text-white tracking-tight leading-none">
            Bingo{' '}
            <span
              style={{
                background: 'linear-gradient(135deg, #60a5fa, #38bdf8)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              Pro
            </span>
          </h1>
          <p className="text-slate-500 text-[13px] mt-1.5 tracking-[0.08em] uppercase font-medium">
            Sistema de Administracion
          </p>
        </div>

        {/* ── Glass form card ── */}
        <div
          className="relative rounded-2xl overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)',
            boxShadow: '0 32px 64px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.07) inset, 0 1px 0 rgba(255,255,255,0.05) inset',
            backdropFilter: 'blur(20px)',
          }}
        >
          {/* Top gradient accent line */}
          <div
            className="h-[2px]"
            style={{
              background: 'linear-gradient(90deg, transparent 10%, #2563eb 30%, #3b82f6 70%, transparent 90%)',
            }}
          />

          <div className="p-6 sm:p-8">
            <h2 className="text-[17px] font-semibold text-white mb-1">Iniciar Sesion</h2>
            <p className="text-slate-500 text-sm mb-6">Ingrese sus credenciales para continuar</p>

            {/* Error */}
            {error && (
              <div
                className="mb-5 p-3 rounded-xl flex items-center gap-3"
                style={{
                  background: 'rgba(239, 68, 68, 0.08)',
                  border: '1px solid rgba(239, 68, 68, 0.15)',
                }}
              >
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                <span className="text-red-400 text-sm">{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Username */}
              <div className="space-y-1.5">
                <label htmlFor="username" className="text-slate-400 text-xs font-medium tracking-wide uppercase block">
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
                  className="h-11 bg-white/[0.04] border-white/[0.08] text-white placeholder:text-slate-600 focus:border-blue-500/40 focus:ring-blue-500/15 rounded-xl text-[15px]"
                />
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <label htmlFor="password" className="text-slate-400 text-xs font-medium tracking-wide uppercase block">
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
                  className="h-11 bg-white/[0.04] border-white/[0.08] text-white placeholder:text-slate-600 focus:border-blue-500/40 focus:ring-blue-500/15 rounded-xl text-[15px]"
                />
              </div>

              {/* Submit */}
              <div className="pt-1">
                <Button
                  type="submit"
                  disabled={isLoading}
                  className="w-full h-11 rounded-xl text-[15px] font-semibold border-0 relative overflow-hidden transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]"
                  size="lg"
                  style={{
                    background: 'linear-gradient(135deg, #2563eb 0%, #3b82f6 50%, #60a5fa 100%)',
                    boxShadow: '0 8px 24px rgba(37, 99, 235, 0.35), 0 2px 8px rgba(59, 130, 246, 0.2)',
                  }}
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

        {/* Footer */}
        <p className="text-center text-[11px] text-slate-400 mt-6 tracking-wide">
          Bingo Pro Manager &middot; v2.0
        </p>
      </div>

      {/* ── Inline styles for floating animation ── */}
      <style>{`
        @keyframes login-float {
          0% { transform: translateY(0) rotate(0deg); }
          100% { transform: translateY(-20px) rotate(6deg); }
        }
      `}</style>
    </div>
  );
}
