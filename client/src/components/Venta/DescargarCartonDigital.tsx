import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Search, Loader2, XCircle, CreditCard, FileDown,
  Hash, Tag, CalendarDays, Warehouse, User, CheckCircle,
} from 'lucide-react';
import api from '@/services/api';
import { normalizeSerial } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

interface CardInfo {
  card_number: number;
  card_code: string;
  serial: string;
  is_sold: boolean;
  buyer_name: string | null;
  event_name: string;
  almacen_name: string | null;
}

export default function DescargarCartonDigital() {
  const [serial, setSerial] = useState('');
  const [cardInfo, setCardInfo] = useState<CardInfo | null>(null);
  const [error, setError] = useState('');

  const searchMutation = useMutation({
    mutationFn: (s: string) =>
      api.get<{ success: boolean; data: CardInfo; error?: string }>(`/venta/buscar-serial/${encodeURIComponent(s)}`).then(r => r.data),
    onSuccess: (data) => {
      if (data.success && data.data) {
        setCardInfo(data.data);
        setError('');
      }
    },
    onError: (err: any) => {
      setCardInfo(null);
      setError(err.response?.data?.error || 'Carton no encontrado');
    },
  });

  const downloadMutation = useMutation({
    mutationFn: async (s: string) => {
      const resp = await api.post('/venta/descargar-digital', { serial: s }, { responseType: 'blob' });
      return resp.data as Blob;
    },
    onSuccess: (blob) => {
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `carton_${cardInfo?.serial || 'digital'}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => window.URL.revokeObjectURL(url), 200);
    },
    onError: (err: any) => {
      setError(err.response?.data?.error || 'Error generando PDF');
    },
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (serial.trim().length >= 3) {
      setError('');
      setCardInfo(null);
      searchMutation.mutate(normalizeSerial(serial.trim()));
    }
  };

  const handleDownload = () => {
    if (cardInfo) {
      downloadMutation.mutate(cardInfo.serial);
    }
  };

  const isSearching = searchMutation.isPending;
  const isDownloading = downloadMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="page-header">
        <h2 className="text-2xl font-bold tracking-tight">Descargar Carton Digital</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Busca un carton por serial y descarga su PDF digital
        </p>
      </div>

      {/* Busqueda */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <form onSubmit={handleSearch} className="flex flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-[200px]">
              <Input
                id="serial"
                className="font-mono uppercase h-9"
                value={serial}
                onChange={(e) => setSerial(e.target.value)}
                placeholder="Serial del carton (ej: 00001-01)"
                maxLength={20}
                required
                onKeyDown={(e) => e.key === 'Enter' && handleSearch(e)}
              />
            </div>
            <Button
              type="submit"
              disabled={serial.trim().length < 3 || isSearching}
              size="sm"
              className="h-9"
            >
              {isSearching ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Search className="h-4 w-4 mr-1" />
              )}
              Buscar
            </Button>
            {cardInfo && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9"
                onClick={() => { setSerial(''); setCardInfo(null); setError(''); }}
              >
                Limpiar
              </Button>
            )}
          </form>
        </CardContent>
      </Card>

      {/* Error */}
      {error && (
        <Card className="border-destructive/50 bg-destructive/10">
          <CardContent className="pt-4 pb-4 flex items-center gap-3">
            <XCircle className="text-destructive h-5 w-5 flex-shrink-0" />
            <p className="text-destructive font-medium text-sm">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Resultado */}
      {cardInfo && (
        <>
          {/* Info Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                    <CreditCard className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Serial</p>
                    <p className="text-lg font-mono font-bold text-primary">{cardInfo.serial}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
                    <Hash className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Numero</p>
                    <p className="text-lg font-bold">#{cardInfo.card_number}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
                    <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Estado</p>
                    <Badge variant={cardInfo.is_sold ? 'success' : 'secondary'} className="mt-0.5">
                      {cardInfo.is_sold ? 'Vendido' : 'Disponible'}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-orange-100 dark:bg-orange-900/30">
                    <Tag className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Codigo</p>
                    <p className="text-lg font-mono font-bold">{cardInfo.card_code}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Detalle + Descarga */}
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="p-3 text-left font-medium">Campo</th>
                      <th className="p-3 text-left font-medium">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-border/50">
                      <td className="p-3 text-muted-foreground"><div className="flex items-center gap-2"><CalendarDays className="h-4 w-4" /> Evento</div></td>
                      <td className="p-3 font-medium">{cardInfo.event_name}</td>
                    </tr>
                    <tr className="border-b border-border/50">
                      <td className="p-3 text-muted-foreground"><div className="flex items-center gap-2"><CreditCard className="h-4 w-4" /> Serial</div></td>
                      <td className="p-3 font-mono font-bold text-primary">{cardInfo.serial}</td>
                    </tr>
                    <tr className="border-b border-border/50">
                      <td className="p-3 text-muted-foreground"><div className="flex items-center gap-2"><Tag className="h-4 w-4" /> Codigo</div></td>
                      <td className="p-3 font-mono">{cardInfo.card_code}</td>
                    </tr>
                    <tr className="border-b border-border/50">
                      <td className="p-3 text-muted-foreground"><div className="flex items-center gap-2"><Hash className="h-4 w-4" /> Numero</div></td>
                      <td className="p-3 font-bold">#{cardInfo.card_number}</td>
                    </tr>
                    {cardInfo.almacen_name && (
                      <tr className="border-b border-border/50">
                        <td className="p-3 text-muted-foreground"><div className="flex items-center gap-2"><Warehouse className="h-4 w-4" /> Almacen</div></td>
                        <td className="p-3">{cardInfo.almacen_name}</td>
                      </tr>
                    )}
                    {cardInfo.buyer_name && (
                      <tr className="border-b border-border/50">
                        <td className="p-3 text-muted-foreground"><div className="flex items-center gap-2"><User className="h-4 w-4" /> Comprador</div></td>
                        <td className="p-3 font-medium">{cardInfo.buyer_name}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Boton Descargar */}
              <div className="p-4 border-t">
                <Button
                  onClick={handleDownload}
                  disabled={isDownloading}
                  className="w-full"
                  size="lg"
                >
                  {isDownloading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Generando PDF...
                    </>
                  ) : (
                    <>
                      <FileDown className="mr-2 h-5 w-5" />
                      Descargar PDF Digital
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
