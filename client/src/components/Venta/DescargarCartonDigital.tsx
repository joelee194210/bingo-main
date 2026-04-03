import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Search, Loader2, XCircle, CreditCard, FileDown } from 'lucide-react';
import api from '@/services/api';
import { normalizeSerial } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface CardInfo {
  card_number: number;
  card_code: string;
  serial: string;
  is_sold: boolean;
  buyer_name: string | null;
  event_name: string;
  almacen_name: string | null;
}

interface DownloadResult {
  card_code: string;
  serial: string;
  card_number: number;
  download_url: string;
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
      const res = await api.post<{ success: boolean; data: DownloadResult; error?: string }>('/venta/descargar-digital', { serial: s });
      return res.data;
    },
    onSuccess: async (data) => {
      if (data.success && data.data.download_url) {
        try {
          const blob = await api.get(data.data.download_url, { responseType: 'blob' });
          const url = window.URL.createObjectURL(new Blob([blob.data]));
          const link = document.createElement('a');
          link.href = url;
          link.setAttribute('download', `carton_${data.data.serial}.pdf`);
          document.body.appendChild(link);
          link.click();
          link.remove();
          window.URL.revokeObjectURL(url);
        } catch {
          setError('Error descargando el PDF');
        }
      }
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
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="page-header">
        <h2 className="text-2xl font-bold tracking-tight">Descargar Carton Digital</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Busca un carton por serial y descarga su PDF digital
        </p>
      </div>

      {/* Busqueda */}
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSearch} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="serial">Serial del Carton</Label>
              <Input
                id="serial"
                className="font-mono uppercase text-lg"
                value={serial}
                onChange={(e) => setSerial(e.target.value)}
                placeholder="Ej: 00001-01"
                maxLength={20}
                required
              />
              <p className="text-xs text-muted-foreground">
                Ingresa el serial completo (00001-01) o parcial (1-1)
              </p>
            </div>

            <Button
              type="submit"
              disabled={serial.trim().length < 3 || isSearching}
              className="w-full"
              size="lg"
            >
              {isSearching ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Buscando...
                </>
              ) : (
                <>
                  <Search className="mr-2 h-4 w-4" />
                  Buscar Carton
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Error */}
      {error && (
        <Card className="border-destructive/50 bg-destructive/10">
          <CardContent className="pt-6 flex items-center gap-3">
            <XCircle className="text-destructive h-6 w-6 flex-shrink-0" />
            <p className="text-destructive font-medium">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Resultado */}
      {cardInfo && (
        <Card>
          <CardContent className="pt-6 space-y-6">
            <div className="flex items-center gap-3">
              <CreditCard className="h-6 w-6 text-primary" />
              <span className="font-semibold text-lg">Carton Encontrado</span>
              <Badge variant={cardInfo.is_sold ? 'success' : 'secondary'}>
                {cardInfo.is_sold ? 'Vendido' : 'Disponible'}
              </Badge>
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Serial</p>
                <p className="font-mono font-bold text-xl text-primary">{cardInfo.serial}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Numero</p>
                <p className="font-bold text-xl">#{cardInfo.card_number}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Codigo</p>
                <p className="font-mono font-bold">{cardInfo.card_code}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Evento</p>
                <p className="font-medium">{cardInfo.event_name}</p>
              </div>
              {cardInfo.almacen_name && (
                <div>
                  <p className="text-muted-foreground">Almacen</p>
                  <p className="font-medium">{cardInfo.almacen_name}</p>
                </div>
              )}
              {cardInfo.buyer_name && (
                <div>
                  <p className="text-muted-foreground">Comprador</p>
                  <p className="font-medium">{cardInfo.buyer_name}</p>
                </div>
              )}
            </div>

            {/* Boton Descargar */}
            <Button
              onClick={handleDownload}
              disabled={isDownloading}
              className="w-full"
              size="lg"
              variant="default"
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
          </CardContent>
        </Card>
      )}
    </div>
  );
}
