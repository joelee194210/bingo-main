import { useState, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const success = await login(username, password);

      if (success) {
        navigate(from, { replace: true });
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
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950" />

      {/* Subtle grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, white 1px, transparent 0)`,
          backgroundSize: '40px 40px',
        }}
      />

      {/* Ambient glow */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-amber-500/[0.07] blur-[120px] rounded-full" />

      <div className="max-w-[400px] w-full mx-4 relative z-10 animate-fade-in-up">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="sidebar-logo w-14 h-14 rounded-2xl flex items-center justify-center text-2xl font-bold text-white mx-auto mb-4">
            B
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Bingo Pro</h1>
          <p className="text-slate-400 text-sm mt-1">Sistema de Administracion</p>
        </div>

        <Card className="border-white/[0.08] bg-white/[0.04] backdrop-blur-xl shadow-2xl">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-lg text-white">Iniciar Sesion</CardTitle>
            <CardDescription className="text-slate-400">Ingrese sus credenciales para continuar</CardDescription>
          </CardHeader>

          <CardContent>
            {error && (
              <div className="mb-5 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-3">
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                <span className="text-red-400 text-sm">{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username" className="text-slate-300 text-sm">Usuario</Label>
                <Input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Ingrese su usuario"
                  required
                  autoComplete="username"
                  autoFocus
                  className="bg-white/[0.06] border-white/[0.1] text-white placeholder:text-slate-500 focus:border-amber-500/50 focus:ring-amber-500/20"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-slate-300 text-sm">Contrasena</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Ingrese su contrasena"
                  required
                  autoComplete="current-password"
                  className="bg-white/[0.06] border-white/[0.1] text-white placeholder:text-slate-500 focus:border-amber-500/50 focus:ring-amber-500/20"
                />
              </div>

              <Button
                type="submit"
                disabled={isLoading}
                className="w-full bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white shadow-lg shadow-amber-500/20 border-0"
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
            </form>

            {import.meta.env.DEV && (
              <div className="mt-6 pt-5 border-t border-white/[0.06]">
                <p className="text-xs text-slate-500 text-center">
                  Demo:{' '}
                  <code className="bg-white/[0.06] px-1.5 py-0.5 rounded text-amber-400/70 text-[11px]">admin</code>
                  {' / '}
                  <code className="bg-white/[0.06] px-1.5 py-0.5 rounded text-amber-400/70 text-[11px]">admin123</code>
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
