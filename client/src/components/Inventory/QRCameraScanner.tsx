import { useCallback, useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Camera, CameraOff } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface QRCameraScannerProps {
  onScan: (code: string) => void;
  active: boolean;
}

export default function QRCameraScanner({ onScan, active }: QRCameraScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastScanRef = useRef<string>('');
  const lastScanTimeRef = useRef<number>(0);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const startScanner = useCallback(async () => {
    if (!containerRef.current) return;
    setError(null);

    try {
      const scanner = new Html5Qrcode('qr-reader');
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1,
        },
        (decodedText) => {
          // Evitar scans duplicados rapidos (debounce 2s)
          const now = Date.now();
          if (decodedText === lastScanRef.current && now - lastScanTimeRef.current < 2000) {
            return;
          }
          lastScanRef.current = decodedText;
          lastScanTimeRef.current = now;
          onScanRef.current(decodedText);
        },
        () => {
          // Scan error silencioso (no encontro QR en frame)
        }
      );
      setScanning(true);
    } catch (err: any) {
      const msg = err?.message || err?.toString() || 'Error al acceder a la camara';
      if (msg.includes('NotAllowedError') || msg.includes('Permission')) {
        setError('Permiso de camara denegado. Permite el acceso en la configuracion del navegador.');
      } else if (msg.includes('NotFoundError') || msg.includes('no camera')) {
        setError('No se encontro camara disponible.');
      } else {
        setError(msg);
      }
    }
  }, []);

  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch {
        // ignore
      }
      scannerRef.current = null;
    }
    setScanning(false);
  }, []);

  // Auto-start cuando active cambia a true, cleanup cuando false
  useEffect(() => {
    if (active && !scanning) {
      startScanner();
    }
    if (!active && scanning) {
      stopScanner();
    }
    return () => {
      stopScanner();
    };
  }, [active, scanning, startScanner, stopScanner]);

  if (!active) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium flex items-center gap-2">
          <Camera className="h-4 w-4" />
          Escaner QR
        </span>
        {!scanning ? (
          <Button size="sm" variant="outline" onClick={startScanner}>
            <Camera className="mr-1 h-3 w-3" />
            Abrir Camara
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={stopScanner}>
            <CameraOff className="mr-1 h-3 w-3" />
            Cerrar Camara
          </Button>
        )}
      </div>

      <div
        id="qr-reader"
        ref={containerRef}
        className={`rounded-lg overflow-hidden bg-black ${scanning ? 'min-h-[280px]' : 'h-0'}`}
      />

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {scanning && (
        <p className="text-xs text-muted-foreground text-center">
          Apunta la camara al codigo QR de la caja, lote o carton
        </p>
      )}
    </div>
  );
}
