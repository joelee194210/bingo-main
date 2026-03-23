import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Trash2, Package, ClipboardList, ScanLine, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  createAsignacion,
  getAlmacenes,
  getMisAlmacenes,
  ejecutarMovimientoBulk,
  getDocumentoPdf,
} from '@/services/api';
import {
  PROPOSITO_LABELS,
  type TipoEntidad,
  type AsignacionProposito,
} from '@/types';
import SignaturePad from './SignaturePad';
import QRCameraScanner from './QRCameraScanner';

type TipoMovimiento = 'traslado' | 'consignacion' | 'devolucion' | 'asignar_persona';

const TIPO_MOVIMIENTO_LABELS: Record<TipoMovimiento, string> = {
  traslado: 'Traslado entre Almacenes',
  consignacion: 'Consignacion (entregar a otro almacen)',
  devolucion: 'Devolucion (recibir de vuelta)',
  asignar_persona: 'Asignar a Persona (custodia/venta)',
};

const TIPO_ENTIDAD_LABELS: Record<TipoEntidad, string> = {
  caja: 'Caja',
  libreta: 'Lote',
  carton: 'Carton',
};

interface ItemMovimiento {
  tipo: TipoEntidad;
  referencia: string;
}

interface MovimientoDialogProps {
  eventId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function MovimientoDialog({ eventId, open, onOpenChange }: MovimientoDialogProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [tipoMovimiento, setTipoMovimiento] = useState<TipoMovimiento>('traslado');
  const [almacenOrigenId, setAlmacenOrigenId] = useState<string>('');
  const [almacenDestinoId, setAlmacenDestinoId] = useState<string>('');
  const [tipoEntidad, setTipoEntidad] = useState<TipoEntidad>('caja');
  const [inputRef, setInputRef] = useState('');

  // Lista de items a mover
  const [items, setItems] = useState<ItemMovimiento[]>([]);

  // Solo para asignar_persona
  const [personaNombre, setPersonaNombre] = useState('');
  const [personaTelefono, setPersonaTelefono] = useState('');
  const [proposito, setProposito] = useState<AsignacionProposito>('venta');
  const [firmaEntrega, setFirmaEntrega] = useState<string | null>(null);
  const [firmaRecibe, setFirmaRecibe] = useState<string | null>(null);

  const [processing, setProcessing] = useState(false);
  const [showScanner, setShowScanner] = useState(false);

  const { data: almacenesData } = useQuery({
    queryKey: ['almacenes', eventId],
    queryFn: () => getAlmacenes(eventId),
    enabled: open,
  });
  const almacenes = almacenesData?.data ?? [];

  // Obtener almacenes asignados al usuario (para no-admin)
  const { data: misAlmacenesData } = useQuery({
    queryKey: ['mis-almacenes'],
    queryFn: getMisAlmacenes,
    enabled: open && !isAdmin,
  });

  // Almacen asignado del usuario para este evento
  const miAlmacen = misAlmacenesData?.data?.find(a => a.event_id === eventId);

  // Auto-fijar almacen para no-admin
  useEffect(() => {
    if (!isAdmin && miAlmacen) {
      if (tipoMovimiento === 'devolucion') {
        // En devolucion, el destino es mi almacen
        if (!almacenDestinoId) setAlmacenDestinoId(miAlmacen.almacen_id.toString());
      } else {
        // En traslado/consignacion/asignar, el origen es mi almacen
        if (!almacenOrigenId) setAlmacenOrigenId(miAlmacen.almacen_id.toString());
      }
    }
  }, [isAdmin, miAlmacen, almacenOrigenId, almacenDestinoId, tipoMovimiento]);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['almacen-tree'] });
    queryClient.invalidateQueries({ queryKey: ['almacenes'] });
    queryClient.invalidateQueries({ queryKey: ['resumen-inventario'] });
    queryClient.invalidateQueries({ queryKey: ['cajas-disponibles'] });
    queryClient.invalidateQueries({ queryKey: ['cajas'] });
    queryClient.invalidateQueries({ queryKey: ['asignaciones'] });
    queryClient.invalidateQueries({ queryKey: ['movimientos'] });
    queryClient.invalidateQueries({ queryKey: ['documentos'] });
    queryClient.invalidateQueries({ queryKey: ['mis-almacenes'] });
  };

  const resetForm = () => {
    setTipoMovimiento('traslado');
    setAlmacenOrigenId(isAdmin ? '' : (miAlmacen?.almacen_id.toString() || ''));
    setAlmacenDestinoId('');
    setTipoEntidad('caja');
    setInputRef('');
    setItems([]);
    setPersonaNombre('');
    setPersonaTelefono('');
    setProposito('venta');
    setFirmaEntrega(null);
    setFirmaRecibe(null);
    setShowScanner(false);
  };

  // Detectar tipo de entidad por codigo
  const detectTipo = (code: string): TipoEntidad => {
    const upper = code.toUpperCase();
    if (upper.startsWith('C') && /^C\d+$/.test(upper)) return 'caja';
    if (upper.startsWith('L') && /^L\d+$/.test(upper)) return 'libreta';
    return 'carton';
  };

  // Procesar QR escaneado
  const handleQRScan = (rawCode: string) => {
    const code = rawCode.trim().toUpperCase();
    if (!code) return;

    const tipo = detectTipo(code);
    if (items.some(i => i.referencia === code && i.tipo === tipo)) {
      toast.info(`${TIPO_ENTIDAD_LABELS[tipo]} "${code}" ya esta en la lista`);
      return;
    }

    setItems(prev => [...prev, { tipo, referencia: code }]);
    toast.success(`${TIPO_ENTIDAD_LABELS[tipo]} "${code}" agregada`);
  };

  // Agregar item a la lista
  const addItem = () => {
    const ref = inputRef.trim().toUpperCase();
    if (!ref) return;
    if (items.some(i => i.referencia === ref && i.tipo === tipoEntidad)) {
      toast.error(`${TIPO_ENTIDAD_LABELS[tipoEntidad]} "${ref}" ya esta en la lista`);
      return;
    }
    setItems(prev => [...prev, { tipo: tipoEntidad, referencia: ref }]);
    setInputRef('');
  };

  const removeItem = (index: number) => {
    setItems(prev => prev.filter((_, i) => i !== index));
  };

  // Descargar PDF del documento via blob (con token de auth)
  const downloadDocumentoPdf = async (documentoId: number) => {
    try {
      const blob = await getDocumentoPdf(documentoId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `MOV-${documentoId.toString().padStart(6, '0')}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('No se pudo descargar el PDF');
    }
  };

  // Ejecutar movimiento
  const handleExecute = async () => {
    if (items.length === 0) {
      toast.error('Agrega al menos un item a la lista');
      return;
    }

    setProcessing(true);

    try {
      if (tipoMovimiento === 'traslado' || tipoMovimiento === 'consignacion' || tipoMovimiento === 'devolucion') {
        const origenName = almacenes.find(a => a.id.toString() === almacenOrigenId)?.name || 'Origen';
        const destinoName = almacenes.find(a => a.id.toString() === almacenDestinoId)?.name || 'Destino';

        const result = await ejecutarMovimientoBulk({
          event_id: eventId,
          accion: tipoMovimiento,
          almacen_destino_id: Number(almacenDestinoId),
          almacen_origen_id: Number(almacenOrigenId) || undefined,
          items: items.map(i => ({ tipo: i.tipo, referencia: i.referencia })),
          firma_entrega: firmaEntrega || undefined,
          firma_recibe: firmaRecibe || undefined,
          nombre_entrega: origenName,
          nombre_recibe: destinoName,
        });

        const { documentoId, exitosos, errores } = result.data!;

        invalidateAll();

        if (errores.length === 0) {
          toast.success(`${exitosos} items procesados exitosamente`);
          if (documentoId) await downloadDocumentoPdf(documentoId);
          resetForm();
          onOpenChange(false);
        } else {
          if (exitosos > 0) toast.success(`${exitosos} items exitosos`);
          errores.forEach(e => toast.error(e));
          if (documentoId && exitosos > 0) await downloadDocumentoPdf(documentoId);
        }
      } else if (tipoMovimiento === 'asignar_persona') {
        let exitosos = 0;
        const errores: string[] = [];
        for (const item of items) {
          try {
            await createAsignacion({
              event_id: eventId,
              almacen_id: Number(almacenOrigenId),
              tipo_entidad: item.tipo,
              referencia: item.referencia,
              persona_nombre: personaNombre,
              persona_telefono: personaTelefono || undefined,
              proposito,
              firma_entrega: firmaEntrega || undefined,
              firma_recibe: firmaRecibe || undefined,
              nombre_entrega: 'Entrega',
              nombre_recibe: personaNombre,
            });
            exitosos++;
          } catch (err: any) {
            errores.push(`${item.referencia}: ${err.response?.data?.error ?? 'Error'}`);
          }
        }
        invalidateAll();
        if (errores.length === 0) {
          toast.success(`${exitosos} items procesados exitosamente`);
          resetForm();
          onOpenChange(false);
        } else {
          if (exitosos > 0) toast.success(`${exitosos} exitosos`);
          errores.forEach(e => toast.error(e));
        }
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? 'Error al ejecutar movimiento');
    } finally {
      setProcessing(false);
    }
  };

  const canExecute = (() => {
    if (items.length === 0 || !firmaEntrega) return false;
    if (tipoMovimiento === 'traslado' || tipoMovimiento === 'consignacion') return !!almacenOrigenId && !!almacenDestinoId && almacenOrigenId !== almacenDestinoId;
    if (tipoMovimiento === 'devolucion') return !!almacenOrigenId && !!almacenDestinoId && almacenOrigenId !== almacenDestinoId;
    if (tipoMovimiento === 'asignar_persona') return !!almacenOrigenId && !!personaNombre;
    return false;
  })();

  // Resumen de items por tipo
  const countByType = items.reduce<Record<string, number>>((acc, i) => {
    acc[i.tipo] = (acc[i.tipo] || 0) + 1;
    return acc;
  }, {});

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetForm(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nuevo Movimiento de Inventario</DialogTitle>
          <DialogDescription>
            Selecciona el tipo de movimiento, agrega los items y ejecuta.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Tipo de Movimiento */}
          <div className="space-y-2">
            <Label>Tipo de Movimiento</Label>
            <Select value={tipoMovimiento} onValueChange={(v) => { setTipoMovimiento(v as TipoMovimiento); setItems([]); setAlmacenDestinoId(''); }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(TIPO_MOVIMIENTO_LABELS) as TipoMovimiento[]).map((t) => (
                  <SelectItem key={t} value={t}>
                    {TIPO_MOVIMIENTO_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Almacen Origen / Destino */}
          {tipoMovimiento === 'devolucion' ? (
            // Devolucion: recibir DE otro almacen HACIA mi almacen
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Recibir desde (origen)</Label>
                {isAdmin ? (
                  <Select value={almacenOrigenId} onValueChange={setAlmacenOrigenId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Almacen que devuelve" />
                    </SelectTrigger>
                    <SelectContent>
                      {almacenes.filter(a => a.id.toString() !== almacenDestinoId).map((a) => (
                        <SelectItem key={a.id} value={a.id.toString()}>
                          {a.name} ({a.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Select value={almacenOrigenId} onValueChange={setAlmacenOrigenId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Almacen que devuelve" />
                    </SelectTrigger>
                    <SelectContent>
                      {(() => {
                        const miAlmId = miAlmacen?.almacen_id;
                        const miAlm = almacenes.find(a => a.id === miAlmId);
                        if (!miAlm) return null;
                        // Hijos y hermanos pueden devolver
                        const related = almacenes.filter(a => {
                          if (a.id === miAlmId) return false;
                          if (a.parent_id === miAlmId) return true; // hijo
                          if (miAlm.parent_id && a.parent_id === miAlm.parent_id) return true; // hermano
                          return false;
                        });
                        return related.map((a) => (
                          <SelectItem key={a.id} value={a.id.toString()}>
                            {a.name} ({a.code})
                          </SelectItem>
                        ));
                      })()}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="space-y-2">
                <Label>Recibir en (destino)</Label>
                {!isAdmin && miAlmacen ? (
                  <div className="flex items-center gap-2 h-10 px-3 border rounded-md bg-muted/50">
                    <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm">{miAlmacen.almacen_name} ({miAlmacen.almacen_code})</span>
                  </div>
                ) : (
                  <Select value={almacenDestinoId} onValueChange={setAlmacenDestinoId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Mi almacen" />
                    </SelectTrigger>
                    <SelectContent>
                      {almacenes.filter(a => a.id.toString() !== almacenOrigenId).map((a) => (
                        <SelectItem key={a.id} value={a.id.toString()}>
                          {a.name} ({a.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
          ) : (
            // Traslado / Consignacion / Asignar persona
            <div className={tipoMovimiento !== 'asignar_persona' ? 'grid grid-cols-2 gap-4' : ''}>
              <div className="space-y-2">
                <Label>Almacen origen</Label>
                {!isAdmin && miAlmacen ? (
                  <div className="flex items-center gap-2 h-10 px-3 border rounded-md bg-muted/50">
                    <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm">{miAlmacen.almacen_name} ({miAlmacen.almacen_code})</span>
                  </div>
                ) : (
                  <Select value={almacenOrigenId} onValueChange={(v) => { setAlmacenOrigenId(v); setAlmacenDestinoId(''); }}>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar almacen" />
                    </SelectTrigger>
                    <SelectContent>
                      {almacenes.map((a) => (
                        <SelectItem key={a.id} value={a.id.toString()}>
                          {a.name} ({a.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {(tipoMovimiento === 'traslado' || tipoMovimiento === 'consignacion') && (
                <div className="space-y-2">
                  <Label>Almacen destino</Label>
                  <Select value={almacenDestinoId} onValueChange={setAlmacenDestinoId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar destino" />
                    </SelectTrigger>
                    <SelectContent>
                      {(() => {
                        const origenNum = Number(almacenOrigenId);
                        const origen = almacenes.find(a => a.id === origenNum);
                        if (!origen) return null;

                        if (isAdmin) {
                          const others = almacenes.filter(a => a.id !== origenNum);
                          if (others.length === 0) {
                            return (
                              <div className="px-3 py-2 text-sm text-muted-foreground">
                                No hay otros almacenes disponibles
                              </div>
                            );
                          }
                          return others.map((a) => (
                            <SelectItem key={a.id} value={a.id.toString()}>
                              {a.name} ({a.code})
                            </SelectItem>
                          ));
                        }

                        // No-admin: padre, hermanos e hijos
                        const related = almacenes.filter(a => {
                          if (a.id === origenNum) return false;
                          if (origen.parent_id && a.id === origen.parent_id) return true; // padre
                          if (origen.parent_id && a.parent_id === origen.parent_id) return true; // hermano
                          if (a.parent_id === origenNum) return true; // hijo
                          return false;
                        });
                        if (related.length === 0) {
                          return (
                            <div className="px-3 py-2 text-sm text-muted-foreground">
                              No hay almacenes relacionados
                            </div>
                          );
                        }
                        return related.map((a) => {
                          const icon = a.id === origen.parent_id ? '↑' : a.parent_id === origenNum ? '↓' : '↔';
                          return (
                            <SelectItem key={a.id} value={a.id.toString()}>
                              {icon} {a.name} ({a.code})
                            </SelectItem>
                          );
                        });
                      })()}
                    </SelectContent>
                  </Select>
                  {almacenOrigenId && !isAdmin && (
                    <p className="text-xs text-muted-foreground">
                      ↑ padre, ↔ hermanos, ↓ hijos
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Agregar items */}
          <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Agregar items al movimiento</p>
              <Button
                size="sm"
                variant={showScanner ? 'default' : 'outline'}
                onClick={() => setShowScanner(!showScanner)}
                className="gap-1"
              >
                <ScanLine className="h-4 w-4" />
                {showScanner ? 'Cerrar Scanner' : 'Escanear QR'}
              </Button>
            </div>

            {/* Scanner QR por camara */}
            <QRCameraScanner
              active={showScanner}
              onScan={handleQRScan}
            />

            {/* Input manual */}
            <div className="flex gap-2 items-end">
              <div className="w-32">
                <Label className="text-xs">Tipo</Label>
                <Select value={tipoEntidad} onValueChange={(v) => setTipoEntidad(v as TipoEntidad)}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(TIPO_ENTIDAD_LABELS) as TipoEntidad[]).map((t) => (
                      <SelectItem key={t} value={t}>
                        {TIPO_ENTIDAD_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1">
                <Label className="text-xs">Codigo manual</Label>
                <Input
                  className="h-9"
                  value={inputRef}
                  onChange={(e) => setInputRef(e.target.value)}
                  placeholder={
                    tipoEntidad === 'caja' ? 'Ej: C001' :
                    tipoEntidad === 'libreta' ? 'Ej: L00001 (Lote)' :
                    'Codigo del carton'
                  }
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } }}
                />
              </div>
              <Button size="sm" className="h-9" onClick={addItem} disabled={!inputRef.trim()}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Lista de items */}
          {items.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <div className="bg-muted px-4 py-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Items ({items.length})</span>
                  {Object.entries(countByType).map(([tipo, count]) => (
                    <Badge key={tipo} variant="secondary" className="text-xs gap-1">
                      {tipo === 'caja' && <Package className="h-3 w-3" />}
                      {tipo === 'libreta' && <ClipboardList className="h-3 w-3" />}
                      {count} {tipo}{count > 1 ? 's' : ''}
                    </Badge>
                  ))}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-destructive"
                  onClick={() => setItems([])}
                >
                  Limpiar todo
                </Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Referencia</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="text-muted-foreground text-xs">{idx + 1}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs capitalize">{item.tipo}</Badge>
                      </TableCell>
                      <TableCell className="font-mono font-medium">{item.referencia}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-destructive"
                          onClick={() => removeItem(idx)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Campos adicionales para asignar a persona */}
          {tipoMovimiento === 'asignar_persona' && (
            <div className="border-t pt-4 space-y-4">
              <p className="text-sm font-medium">Datos de la persona</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Nombre</Label>
                  <Input
                    value={personaNombre}
                    onChange={(e) => setPersonaNombre(e.target.value)}
                    placeholder="Nombre completo"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Telefono (opcional)</Label>
                  <Input
                    value={personaTelefono}
                    onChange={(e) => setPersonaTelefono(e.target.value)}
                    placeholder="Telefono"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Proposito</Label>
                <Select value={proposito} onValueChange={(v) => setProposito(v as AsignacionProposito)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PROPOSITO_LABELS) as AsignacionProposito[]).map((p) => (
                      <SelectItem key={p} value={p}>
                        {PROPOSITO_LABELS[p]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* Firmas del comprobante - siempre visibles */}
          {items.length > 0 && (
            <div className="border-t pt-4 space-y-3">
              <p className="text-sm font-medium">Firmas del comprobante de movimiento</p>
              <div className="grid grid-cols-1 gap-4">
                <SignaturePad label="Firma de quien entrega" onSignatureChange={setFirmaEntrega} />
                <SignaturePad
                  label={`Firma de quien recibe${tipoMovimiento === 'asignar_persona' && personaNombre ? ': ' + personaNombre : ''}`}
                  onSignatureChange={setFirmaRecibe}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Se generara un comprobante PDF con el detalle de los items y las firmas.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleExecute}
            disabled={!canExecute || processing}
          >
            {processing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Ejecutar Movimiento ({items.length} items)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
