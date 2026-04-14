import { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ShoppingCart, Plus, Trash2, Package, ClipboardList, ScanLine,
  Loader2, CreditCard, Warehouse, User, Handshake, RotateCcw,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  getMisAlmacenes,
  getResumenInventario,
  ejecutarVenta,
  ejecutarDevolucionPOS,
  validarDevolucion,
  getDocumentoPdf,
  validarReferencia,
} from '@/services/api';
import type { TipoEntidad } from '@/types';
import SignaturePad from './SignaturePad';
import { getStatusColor } from '@/lib/badge-variants';
import { normalizeSerial, extractScanCode } from '@/lib/utils';
import QRCameraScanner from './QRCameraScanner';

const TIPO_ENTIDAD_LABELS: Record<TipoEntidad, string> = {
  caja: 'Caja',
  libreta: 'Lote',
  carton: 'Carton',
};

const TIPO_ICONS: Record<TipoEntidad, typeof Package> = {
  caja: Package,
  libreta: ClipboardList,
  carton: CreditCard,
};

interface ItemVenta {
  tipo: TipoEntidad;
  referencia: string;
  validado?: boolean;
  error?: string;
  info?: string;
}

type ModoPOS = 'venta' | 'consignacion' | 'devolucion';

const MODO_LABELS: Record<ModoPOS, string> = {
  venta: 'Venta',
  consignacion: 'Consignación',
  devolucion: 'Devolución',
};

export default function VentaGeneralPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [modo, setModo] = useState<ModoPOS>('venta');
  const [selectedAlmacen, setSelectedAlmacen] = useState<string>('');
  const [tipoEntidad, setTipoEntidad] = useState<TipoEntidad>('caja');
  const [inputRef, setInputRef] = useState('');
  const [items, setItems] = useState<ItemVenta[]>([]);
  const [buyerName, setBuyerName] = useState('');
  const [buyerCedula, setBuyerCedula] = useState('');
  const [buyerPhone, setBuyerPhone] = useState('');
  const [firmaEntrega, setFirmaEntrega] = useState<string | null>(null);
  const [firmaRecibe, setFirmaRecibe] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [validating, setValidating] = useState(false);
  const [showScanner, setShowScanner] = useState(false);

  const cambiarModo = (nuevo: ModoPOS) => {
    if (nuevo === modo) return;
    setModo(nuevo);
    setItems([]);
    setFirmaEntrega(null);
    setFirmaRecibe(null);
  };

  const { data: misAlmacenesData, isLoading: loadingAlmacenes } = useQuery({
    queryKey: ['mis-almacenes'],
    queryFn: getMisAlmacenes,
  });

  const misAlmacenes = useMemo(() => misAlmacenesData?.data || [], [misAlmacenesData?.data]);
  const currentAlmacen = misAlmacenes.find((a) => a.almacen_id.toString() === selectedAlmacen);

  const { data: resumenData } = useQuery({
    queryKey: ['resumen-inventario', currentAlmacen?.event_id, currentAlmacen?.almacen_id],
    queryFn: () => getResumenInventario(currentAlmacen!.event_id, currentAlmacen!.almacen_id),
    enabled: !!currentAlmacen,
  });

  const resumen = resumenData?.data;

  // Auto-select if only one almacen
  useEffect(() => {
    if (misAlmacenes.length === 1 && !selectedAlmacen) {
      setSelectedAlmacen(misAlmacenes[0].almacen_id.toString());
    }
  }, [misAlmacenes, selectedAlmacen]);

  const detectTipo = (code: string): TipoEntidad => {
    const upper = code.toUpperCase();
    if (upper.startsWith('C') && /^C\d+$/.test(upper)) return 'caja';
    if (upper.startsWith('L') && /^L\d+$/.test(upper)) return 'libreta';
    return 'carton';
  };

  const validateAndAdd = async (ref: string, tipoHint?: TipoEntidad) => {
    if (!currentAlmacen) return;
    const code = ref.trim().toUpperCase();
    if (!code) return;
    const normalizedCode = normalizeSerial(code);

    if (items.some(i => i.referencia === normalizedCode)) {
      toast.info(`"${normalizedCode}" ya esta en la lista`);
      return;
    }

    setValidating(true);
    try {
      if (modo === 'devolucion') {
        const result = await validarDevolucion(currentAlmacen.event_id, normalizedCode, currentAlmacen.almacen_id);
        const data = result.data;
        if (!data || !data.existe) { toast.error(`"${normalizedCode}" no existe`); return; }
        if (!data.valido) { toast.error(`"${normalizedCode}" — ${data.info}`); return; }
        setItems(prev => [...prev, { tipo: 'carton', referencia: normalizedCode, validado: true, info: data.info }]);
        toast.success(`${normalizedCode} — ${data.info}`);
        return;
      }

      const result = await validarReferencia(currentAlmacen.event_id, normalizedCode, currentAlmacen.almacen_id);
      const data = result.data;

      if (!data || !data.existe) {
        toast.error(`"${normalizedCode}" no existe en el sistema`);
        return;
      }

      const tipo = (data.tipo as TipoEntidad) || tipoHint || 'carton';

      if (!data.enMiAlmacen) {
        toast.error(`${TIPO_ENTIDAD_LABELS[tipo]} "${normalizedCode}" no esta en tu almacen (esta en ${data.almacen || 'otro'})`);
        return;
      }

      if ((data.disponibles ?? 0) === 0) {
        toast.error(`${TIPO_ENTIDAD_LABELS[tipo]} "${normalizedCode}" ya fue vendida completamente`);
        return;
      }

      const info = data.totalCartones === 1
        ? (data.vendidos ? 'Ya vendido' : 'Disponible')
        : `${data.disponibles} disponibles de ${data.totalCartones}`;

      setItems(prev => [...prev, { tipo, referencia: normalizedCode, validado: true, info }]);
      toast.success(`${TIPO_ENTIDAD_LABELS[tipo]} "${normalizedCode}" — ${info}`);
    } catch {
      toast.error(`Error validando "${normalizedCode}"`);
    } finally {
      setValidating(false);
    }
  };

  const handleQRScan = (rawCode: string) => {
    const code = extractScanCode(rawCode).toUpperCase();
    if (!code) return;
    const tipo = detectTipo(code);
    validateAndAdd(code, tipo);
  };

  const addItem = () => {
    const ref = inputRef.trim().toUpperCase();
    if (!ref) return;
    validateAndAdd(ref, tipoEntidad).then(() => setInputRef(''));
  };

  const removeItem = (index: number) => {
    setItems(prev => prev.filter((_, i) => i !== index));
  };

  const downloadPdf = async (documentoId: number) => {
    try {
      const blob = await getDocumentoPdf(documentoId);
      if (blob.size < 100 || blob.type === 'application/json') {
        toast.error('PDF no disponible para este documento');
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const prefix = modo === 'consignacion' ? 'CONSIGNACION' : modo === 'devolucion' ? 'DEVOLUCION' : 'VENTA';
      a.download = `${prefix}-${documentoId.toString().padStart(6, '0')}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('No se pudo descargar el comprobante');
    }
  };

  const handleEjecutar = async () => {
    if (!currentAlmacen || items.length === 0) return;
    const requiereComprador = modo !== 'devolucion';
    if (requiereComprador && !buyerName.trim()) {
      toast.error('El nombre de la persona es requerido');
      return;
    }

    const accionLabel = MODO_LABELS[modo].toLowerCase();
    const sujeto = modo === 'devolucion' ? 'almacén' : buyerName;
    if (!confirm(`¿Confirmar ${accionLabel} de ${validItems.length} item(s) a ${sujeto}?`)) return;

    setProcessing(true);
    try {
      let documentoId = 0, exitosos = 0, totalCartones = 0, errores: string[] = [];

      if (modo === 'devolucion') {
        const result = await ejecutarDevolucionPOS({
          event_id: currentAlmacen.event_id,
          almacen_id: currentAlmacen.almacen_id,
          items: validItems.map(i => ({ tipo: i.tipo, referencia: i.referencia })),
          firma_entrega: firmaEntrega || undefined,
          firma_recibe: firmaRecibe || undefined,
          nombre_entrega: currentAlmacen.almacen_name,
          nombre_recibe: currentAlmacen.almacen_name,
        });
        const d = result.data!;
        documentoId = d.documentoId; exitosos = d.exitosos; errores = d.errores;
        totalCartones = exitosos;
      } else {
        const result = await ejecutarVenta({
          event_id: currentAlmacen.event_id,
          almacen_id: currentAlmacen.almacen_id,
          items: validItems.map(i => ({ tipo: i.tipo, referencia: i.referencia })),
          buyer_name: buyerName.trim(),
          buyer_cedula: buyerCedula.trim() || undefined,
          buyer_phone: buyerPhone.trim() || undefined,
          firma_entrega: firmaEntrega || undefined,
          firma_recibe: firmaRecibe || undefined,
          nombre_entrega: currentAlmacen.almacen_name,
          nombre_recibe: buyerName.trim(),
          accion: modo,
        });
        const d = result.data!;
        documentoId = d.documentoId; exitosos = d.exitosos; totalCartones = d.totalCartones; errores = d.errores;
      }

      queryClient.invalidateQueries({ queryKey: ['resumen-inventario'] });
      queryClient.invalidateQueries({ queryKey: ['cajas'] });
      queryClient.invalidateQueries({ queryKey: ['mis-almacenes'] });
      queryClient.invalidateQueries({ queryKey: ['documentos'] });
      queryClient.invalidateQueries({ queryKey: ['movimientos'] });
      queryClient.invalidateQueries({ queryKey: ['almacen-tree'] });
      queryClient.invalidateQueries({ queryKey: ['libretas-sueltas'] });
      queryClient.invalidateQueries({ queryKey: ['cartones-sueltos'] });

      const verbo = modo === 'devolucion' ? 'devueltos' : modo === 'consignacion' ? 'consignados' : 'vendidos';
      if (errores.length === 0) {
        toast.success(`${exitosos} items ${verbo}${totalCartones ? ` — ${totalCartones} cartones` : ''}`);
        if (documentoId) await downloadPdf(documentoId);
        setItems([]);
        setBuyerName('');
        setBuyerCedula('');
        setBuyerPhone('');
        setFirmaEntrega(null);
        setFirmaRecibe(null);
      } else {
        if (exitosos > 0) toast.success(`${exitosos} items ${verbo}`);
        errores.forEach(e => toast.error(e));
        if (documentoId && exitosos > 0) await downloadPdf(documentoId);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? `Error al ejecutar ${MODO_LABELS[modo].toLowerCase()}`);
    } finally {
      setProcessing(false);
    }
  };

  const validItems = items.filter(i => i.validado);
  const requiereComprador = modo !== 'devolucion';
  const canExecute = validItems.length > 0 && !!currentAlmacen && !!firmaEntrega
    && (!requiereComprador || !!buyerName.trim());

  const countByType = items.reduce<Record<string, number>>((acc, i) => {
    acc[i.tipo] = (acc[i.tipo] || 0) + 1;
    return acc;
  }, {});

  if (loadingAlmacenes) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (misAlmacenes.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <ShoppingCart className="h-6 w-6" /> Venta General
        </h1>
        <Card className="text-center py-12">
          <CardContent>
            <Warehouse className="h-16 w-16 mx-auto mb-4 text-muted-foreground/40" />
            <h3 className="text-xl font-semibold mb-2">Sin almacen asignado</h3>
            <p className="text-muted-foreground">
              No tienes ningun almacen asignado. Contacta al administrador.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const ModoIcon = modo === 'consignacion' ? Handshake : modo === 'devolucion' ? RotateCcw : ShoppingCart;
  const subtitle = modo === 'consignacion'
    ? 'Entregar en consignación — los cartones quedan marcados como vendidos hasta su devolución'
    : modo === 'devolucion'
      ? 'Devolver cartones vendidos o consignados al inventario disponible'
      : 'Vender cajas, lotes o cartones a cualquier persona';
  const tituloPagina = modo === 'consignacion' ? 'Consignación General' : modo === 'devolucion' ? 'Devolución General' : 'Venta General';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <ModoIcon className="h-6 w-6" /> {tituloPagina}
        </h1>
        <p className="text-muted-foreground text-sm mt-1">{subtitle}</p>
      </div>

      {/* Selector de modo */}
      <Tabs value={modo} onValueChange={(v) => cambiarModo(v as ModoPOS)}>
        <TabsList className="grid w-full grid-cols-3 max-w-xl">
          <TabsTrigger value="venta" className="gap-1">
            <ShoppingCart className="h-4 w-4" /> Venta
          </TabsTrigger>
          <TabsTrigger value="consignacion" className="gap-1">
            <Handshake className="h-4 w-4" /> Consignación
          </TabsTrigger>
          <TabsTrigger value="devolucion" className="gap-1">
            <RotateCcw className="h-4 w-4" /> Devolución
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Almacen selector */}
      {misAlmacenes.length > 1 && (
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-2 max-w-sm">
              <Label>Almacen</Label>
              <Select value={selectedAlmacen} onValueChange={setSelectedAlmacen}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar almacen..." />
                </SelectTrigger>
                <SelectContent>
                  {misAlmacenes.map((a) => (
                    <SelectItem key={a.almacen_id} value={a.almacen_id.toString()}>
                      {a.almacen_name} ({a.almacen_code}) - {a.event_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      )}

      {currentAlmacen && (
        <>
          {/* Info del almacen + resumen */}
          <div className="flex flex-wrap items-center gap-3 px-1">
            <Warehouse className="h-5 w-5 text-primary" />
            <div>
              <span className="font-semibold">{currentAlmacen.almacen_name}</span>
              <span className="text-muted-foreground text-sm ml-2">({currentAlmacen.almacen_code})</span>
            </div>
            {resumen && (
              <div className="sm:ml-auto flex items-center gap-4 text-sm">
                <span><strong>{resumen.totalCajas}</strong> cajas</span>
                <span><strong>{resumen.totalLibretas}</strong> lotes</span>
                <span><strong>{resumen.cartonesDisponibles}</strong> disponibles</span>
              </div>
            )}
          </div>

          {/* Datos de la persona (oculto en devolución) */}
          {requiereComprador && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <User className="h-4 w-4" /> {modo === 'consignacion' ? 'Datos del consignatario' : 'Datos de la persona'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Nombre <span className="text-destructive">*</span></Label>
                    <Input
                      value={buyerName}
                      onChange={(e) => setBuyerName(e.target.value)}
                      placeholder="Nombre completo"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Cedula</Label>
                    <Input
                      value={buyerCedula}
                      onChange={(e) => setBuyerCedula(e.target.value)}
                      placeholder={modo === 'consignacion' ? 'Cedula del consignatario' : 'Cedula del comprador'}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Telefono</Label>
                    <Input
                      type="tel"
                      value={buyerPhone}
                      onChange={(e) => setBuyerPhone(e.target.value)}
                      placeholder="6000-0000"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Agregar items */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {modo === 'devolucion' ? 'Cartones a devolver' : modo === 'consignacion' ? 'Items a consignar' : 'Items a vender'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Scanner QR */}
              <div className="flex gap-2">
                <Button
                  variant={showScanner ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setShowScanner(!showScanner)}
                >
                  <ScanLine className="h-4 w-4 mr-1" /> {showScanner ? 'Cerrar Scanner' : 'Escanear QR'}
                </Button>
              </div>

              {showScanner && (
                <div className="border rounded-lg p-3">
                  <QRCameraScanner
                    onScan={handleQRScan}
                    active={showScanner}
                  />
                </div>
              )}

              {/* Input manual */}
              <div className="flex gap-2 items-end">
                <div className="space-y-2">
                  <Label>Tipo</Label>
                  <Select value={tipoEntidad} onValueChange={(v) => setTipoEntidad(v as TipoEntidad)}>
                    <SelectTrigger className="w-[130px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="caja">Caja</SelectItem>
                      <SelectItem value="libreta">Lote</SelectItem>
                      <SelectItem value="carton">Carton</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 flex-1">
                  <Label>Codigo</Label>
                  <Input
                    value={inputRef}
                    onChange={(e) => setInputRef(e.target.value)}
                    placeholder="Ej: C0001, L0001, ABC12"
                    onKeyDown={(e) => { if (e.key === 'Enter') addItem(); }}
                  />
                </div>
                <Button onClick={addItem} size="icon" disabled={validating} aria-label="Agregar item">
                  {validating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                </Button>
              </div>

              {/* Items list */}
              {items.length > 0 && (
                <>
                  <div className="flex gap-2 flex-wrap">
                    {Object.entries(countByType).map(([tipo, count]) => {
                      const Icon = TIPO_ICONS[tipo as TipoEntidad];
                      return (
                        <Badge key={tipo} className={getStatusColor(tipo) + ' gap-1'}>
                          <Icon className="h-3 w-3" /> {count} {TIPO_ENTIDAD_LABELS[tipo as TipoEntidad]}(s)
                        </Badge>
                      );
                    })}
                  </div>
                  <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">#</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Referencia</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead className="w-12"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((item, idx) => (
                        <TableRow key={idx} className={item.error ? 'bg-destructive/10' : ''}>
                          <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                          <TableCell>
                            <Badge className={getStatusColor(item.tipo) + ' text-xs'}>{TIPO_ENTIDAD_LABELS[item.tipo]}</Badge>
                          </TableCell>
                          <TableCell className="font-mono font-bold">{item.referencia}</TableCell>
                          <TableCell>
                            {item.error ? (
                              <span className="text-xs text-destructive font-medium">{item.error}</span>
                            ) : item.info ? (
                              <span className="text-xs text-green-600 font-medium">{item.info}</span>
                            ) : (
                              <span className="text-xs text-muted-foreground">Validando...</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Button variant="ghost" size="icon" onClick={() => removeItem(idx)} aria-label="Eliminar item">
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Firmas */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Firmas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <SignaturePad
                label={`${modo === 'devolucion' ? 'Recibe' : 'Vendedor'}: ${user?.full_name || user?.username || ''}`}
                onSignatureChange={setFirmaEntrega}
              />
              <SignaturePad
                label={modo === 'devolucion'
                  ? 'Entrega (devolvedor)'
                  : `${modo === 'consignacion' ? 'Consignatario' : 'Recibe'}: ${buyerName || '(ingresar nombre)'}`}
                onSignatureChange={setFirmaRecibe}
              />
            </CardContent>
          </Card>

          {/* Boton ejecutar */}
          <div className="flex justify-end">
            <Button
              size="lg"
              onClick={handleEjecutar}
              disabled={!canExecute || processing}
              className="gap-2"
            >
              {processing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ModoIcon className="h-4 w-4" />
              )}
              Ejecutar {MODO_LABELS[modo]} ({validItems.length} items)
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
