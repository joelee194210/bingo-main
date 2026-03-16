import { useState, useRef, useEffect, useCallback, Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getBackupEvents,
  downloadFullBackup,
  downloadEventBackup,
  downloadEventDump,
  restoreEventBackup,
  restoreFullBackup,
  restoreEventDump,
  getBackupProgress,
  getActivityLog,
  type BackupEvent,
  type BackupJobProgress,
  type ActivityLogEntry,
} from '@/services/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Download,
  Upload,
  Database,
  Calendar,
  HardDrive,
  Loader2,
  CheckCircle,
  AlertTriangle,
  FileJson,
  FileCode,
  CreditCard,
  Gamepad2,
  RotateCcw,
  ScrollText,
  ChevronDown,
  ChevronUp,
  XCircle,
  RefreshCw,
} from 'lucide-react';

function formatNumber(n: number) {
  return n.toLocaleString('es-VE');
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('es-VE', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(d: string) {
  return new Date(d).toLocaleString('es-VE', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatElapsed(ms: number) {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  return `${mins}m ${secs % 60}s`;
}

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  backup_full_export: { label: 'Backup completo', color: 'bg-blue-100 text-blue-700' },
  backup_event_export: { label: 'Backup evento', color: 'bg-cyan-100 text-cyan-700' },
  backup_full_restore: { label: 'Restauracion completa', color: 'bg-green-100 text-green-700' },
  backup_event_restore: { label: 'Restauracion evento', color: 'bg-emerald-100 text-emerald-700' },
  backup_full_export_error: { label: 'Error backup completo', color: 'bg-red-100 text-red-700' },
  backup_event_export_error: { label: 'Error backup evento', color: 'bg-red-100 text-red-700' },
  backup_full_restore_error: { label: 'Error restauracion completa', color: 'bg-red-100 text-red-700' },
  backup_event_restore_error: { label: 'Error restauracion evento', color: 'bg-red-100 text-red-700' },
};

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// =====================================================
// Progress Panel Component
// =====================================================
function ProgressPanel({ jobId, onDone }: { jobId: string; onDone: (progress: BackupJobProgress) => void }) {
  const [progress, setProgress] = useState<BackupJobProgress | null>(null);
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; });

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const res = await getBackupProgress(jobId);
        if (!active) return;
        if (res.data) {
          setProgress(res.data);
          if (res.data.status === 'completed' || res.data.status === 'error') {
            onDoneRef.current(res.data);
            return; // stop polling
          }
        }
      } catch {
        // ignore errors polling
      }
      if (active) setTimeout(poll, 800);
    };
    poll();
    return () => { active = false; };
  }, [jobId]);

  if (!progress) {
    return (
      <div className="flex items-center gap-3 p-4 rounded-lg border bg-blue-500/10 border-blue-500/30">
        <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
        <span className="text-sm text-blue-700 dark:text-blue-400">Conectando...</span>
      </div>
    );
  }

  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
  const elapsed = Date.now() - progress.startedAt;
  const isError = progress.status === 'error';
  const isDone = progress.status === 'completed';

  return (
    <div className={`p-4 rounded-lg border space-y-3 ${
      isError ? 'bg-destructive/10 border-destructive/30' :
      isDone ? 'bg-green-500/10 border-green-500/30' :
      'bg-blue-500/10 border-blue-500/30'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isError ? (
            <XCircle className="h-5 w-5 text-destructive" />
          ) : isDone ? (
            <CheckCircle className="h-5 w-5 text-green-600" />
          ) : (
            <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
          )}
          <span className={`text-sm font-medium ${
            isError ? 'text-destructive' : isDone ? 'text-green-700 dark:text-green-400' : 'text-blue-700 dark:text-blue-400'
          }`}>
            {progress.step}
          </span>
        </div>
        <span className="text-xs text-muted-foreground font-mono">{formatElapsed(elapsed)}</span>
      </div>

      {/* Progress bar */}
      {!isError && progress.total > 0 && (
        <div className="space-y-1">
          <div className="h-2 bg-black/10 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${isDone ? 'bg-green-500' : 'bg-blue-500'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{progress.details}</span>
            <span>{pct}% — {progress.current.toLocaleString()} / {progress.total.toLocaleString()}</span>
          </div>
        </div>
      )}

      {/* Error detail */}
      {isError && progress.error && (
        <div className="p-2 bg-destructive/10 rounded text-xs text-destructive border border-destructive/20">
          <span className="font-medium">Error: </span>{progress.error}
        </div>
      )}
    </div>
  );
}

// =====================================================
// Main BackupPage Component
// =====================================================
export default function BackupPage() {
  const [loadingFull, setLoadingFull] = useState(false);
  const [loadingEvent, setLoadingEvent] = useState<number | null>(null);
  const [loadingEventDump, setLoadingEventDump] = useState<number | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ type: 'event' | 'full' | 'event-dump'; file: File } | null>(null);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [expandedLogId, setExpandedLogId] = useState<number | null>(null);

  const eventFileRef = useRef<HTMLInputElement>(null);
  const eventDumpFileRef = useRef<HTMLInputElement>(null);
  const fullFileRef = useRef<HTMLInputElement>(null);

  const { data: eventsData } = useQuery({
    queryKey: ['backup-events'],
    queryFn: () => getBackupEvents(),
  });

  const { data: logsData, refetch: refetchLogs } = useQuery({
    queryKey: ['backup-logs'],
    queryFn: () => getActivityLog({ category: 'backup', limit: 20 }),
  });

  const backupLogs: ActivityLogEntry[] = (logsData as any)?.data || [];
  const events: BackupEvent[] = eventsData?.data || [];

  const handleFullBackup = async () => {
    setLoadingFull(true);
    setResult(null);
    try {
      const blob = await downloadFullBackup();
      const filename = `bingo_dump_full_${new Date().toISOString().slice(0, 10)}.sql`;
      downloadBlob(blob, filename);
      setResult({ type: 'success', message: 'Dump PostgreSQL completo descargado exitosamente' });
      refetchLogs();
    } catch (err: any) {
      const serverMsg = err?.response?.data?.error;
      setResult({ type: 'error', message: serverMsg || 'Error al generar el dump. Verifique que pg_dump este instalado en el servidor.' });
      refetchLogs();
    } finally {
      setLoadingFull(false);
    }
  };

  const handleEventBackup = async (event: BackupEvent) => {
    setLoadingEvent(event.id);
    setResult(null);
    try {
      const blob = await downloadEventBackup(event.id);
      const safeName = event.name.replace(/[^a-zA-Z0-9]/g, '_');
      const filename = `bingo_backup_${safeName}_${new Date().toISOString().slice(0, 10)}.json`;
      downloadBlob(blob, filename);
      setResult({ type: 'success', message: `Backup del evento "${event.name}" descargado` });
      refetchLogs();
    } catch {
      setResult({ type: 'error', message: 'Error al generar el backup del evento' });
      refetchLogs();
    } finally {
      setLoadingEvent(null);
    }
  };

  const handleEventDump = async (event: BackupEvent) => {
    setLoadingEventDump(event.id);
    setResult(null);
    try {
      const blob = await downloadEventDump(event.id);
      const safeName = event.name.replace(/[^a-zA-Z0-9]/g, '_');
      const filename = `bingo_dump_${safeName}_${new Date().toISOString().slice(0, 10)}.sql`;
      downloadBlob(blob, filename);
      setResult({ type: 'success', message: `Dump SQL del evento "${event.name}" descargado` });
      refetchLogs();
    } catch {
      setResult({ type: 'error', message: 'Error al generar el dump SQL del evento' });
      refetchLogs();
    } finally {
      setLoadingEventDump(null);
    }
  };

  const handleFileSelect = (type: 'event' | 'full' | 'event-dump', e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setConfirmDialog({ type, file });
    e.target.value = '';
  };

  const handleRestore = async () => {
    if (!confirmDialog) return;
    setResult(null);
    setConfirmDialog(null);
    try {
      if (confirmDialog.type === 'event') {
        const res = await restoreEventBackup(confirmDialog.file);
        if (res.data?.jobId) {
          setActiveJobId(res.data.jobId);
        }
      } else if (confirmDialog.type === 'event-dump') {
        const res = await restoreEventDump(confirmDialog.file);
        if (res.data?.jobId) {
          setActiveJobId(res.data.jobId);
        }
      } else {
        const res = await restoreFullBackup(confirmDialog.file);
        if (res.data?.jobId) {
          setActiveJobId(res.data.jobId);
        }
      }
    } catch (err: any) {
      setResult({ type: 'error', message: err?.response?.data?.error || 'Error al iniciar la restauracion' });
    }
  };

  const [needsRelogin, setNeedsRelogin] = useState(false);

  const handleJobDone = useCallback((progress: BackupJobProgress) => {
    setActiveJobId(null);
    const isFullRestore = progress.type === 'restore_full';
    // No intentar refetch de logs si fue un restore completo (sesion muerta)
    if (!isFullRestore) {
      refetchLogs();
    }
    if (progress.status === 'completed') {
      if (progress.result?.event_name) {
        setResult({
          type: 'success',
          message: `Evento restaurado: "${progress.result.event_name}" — ${formatNumber(progress.result.cards_restored || 0)} cartones, ${formatNumber(progress.result.games_restored || 0)} juegos`,
        });
      } else if (isFullRestore) {
        setNeedsRelogin(true);
        setResult({
          type: 'success',
          message: progress.result?.message || 'Dump PostgreSQL restaurado exitosamente',
        });
      } else {
        setResult({
          type: 'success',
          message: `Backup restaurado: ${formatNumber(progress.result?.total_rows_restored || 0)} registros`,
        });
      }
    } else {
      setResult({ type: 'error', message: progress.error || 'Error durante la restauracion' });
    }
  }, [refetchLogs]);

  const isRestoring = !!activeJobId;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Backup y Restauracion</h1>
        <p className="text-muted-foreground">Respaldo y recuperacion de datos del sistema</p>
      </div>

      {/* Status message */}
      {result && !activeJobId && (
        <div className={`flex items-center gap-3 p-4 rounded-lg border ${
          result.type === 'success' ? 'bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-400' : 'bg-destructive/10 border-destructive/30 text-destructive'
        }`}>
          {result.type === 'success' ? <CheckCircle className="h-5 w-5 shrink-0" /> : <AlertTriangle className="h-5 w-5 shrink-0" />}
          <div className="flex-1">
            <span className="text-sm">{result.message}</span>
            {needsRelogin && result.type === 'success' && (
              <div className="mt-2">
                <p className="text-xs text-muted-foreground mb-2">La sesion se invalido al restaurar. Debe iniciar sesion nuevamente.</p>
                <Button
                  size="sm"
                  onClick={() => {
                    localStorage.removeItem('bingo_auth_user');
                    window.location.href = '/login';
                  }}
                >
                  Ir a Iniciar Sesion
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Live progress panel */}
      {activeJobId && (
        <ProgressPanel jobId={activeJobId} onDone={handleJobDone} />
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Backup Completo - PostgreSQL Dump */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5 text-blue-500" />
              Backup Completo (PostgreSQL)
            </CardTitle>
            <CardDescription>
              Genera un dump completo de la base de datos con <code className="text-xs bg-muted px-1 rounded">pg_dump</code>.
              Incluye schema, datos, triggers y secuencias. Ideal para migraciones o disaster recovery.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button onClick={handleFullBackup} disabled={loadingFull || isRestoring} className="w-full">
              {loadingFull ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              Descargar Dump PostgreSQL (.sql)
            </Button>
          </CardContent>
        </Card>

        {/* Restaurar Completo - PostgreSQL Dump */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-orange-500" />
              Restaurar Dump Completo
            </CardTitle>
            <CardDescription>
              Restaura toda la base de datos desde un archivo <code className="text-xs bg-muted px-1 rounded">.sql</code> generado por pg_dump.
              <span className="text-destructive font-medium"> Esto reemplaza todos los datos actuales.</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <input ref={fullFileRef} type="file" accept=".sql" className="hidden" onChange={(e) => handleFileSelect('full', e)} />
            <Button variant="destructive" onClick={() => fullFileRef.current?.click()} disabled={isRestoring} className="w-full">
              <Upload className="mr-2 h-4 w-4" />
              Subir y Restaurar Dump (.sql)
            </Button>
          </CardContent>
        </Card>
      </div>

      <Separator />

      {/* Backup por Evento */}
      <div>
        <h2 className="text-lg font-semibold mb-1 flex items-center gap-2">
          <Calendar className="h-5 w-5 text-blue-500" />
          Backup por Evento
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          Descarga el backup de un evento especifico incluyendo todos sus cartones, juegos, ganadores e inventario.
        </p>

        {events.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              <HardDrive className="h-10 w-10 mx-auto mb-3 opacity-50" />
              <p>No hay eventos disponibles</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {events.map((event) => (
              <Card key={event.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{event.name}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(event.created_at)}</p>
                    </div>
                    <Badge variant={event.status === 'active' ? 'default' : event.status === 'completed' ? 'secondary' : 'outline'} className="text-[10px] shrink-0">
                      {event.status}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <CreditCard className="h-3.5 w-3.5" />
                      {formatNumber(event.total_cards)} cartones
                    </span>
                    <span className="flex items-center gap-1">
                      <Gamepad2 className="h-3.5 w-3.5" />
                      {event.total_games} juegos
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <FileJson className="h-3.5 w-3.5" />
                    <span>{formatNumber(event.cards_sold)} vendidos de {formatNumber(event.total_cards)}</span>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => handleEventBackup(event)}
                      disabled={loadingEvent === event.id || isRestoring}
                    >
                      {loadingEvent === event.id ? (
                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <FileJson className="mr-1 h-3.5 w-3.5" />
                      )}
                      JSON
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => handleEventDump(event)}
                      disabled={loadingEventDump === event.id || isRestoring}
                    >
                      {loadingEventDump === event.id ? (
                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <FileCode className="mr-1 h-3.5 w-3.5" />
                      )}
                      SQL
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Separator />

      {/* Restaurar Evento */}
      <div>
        <h2 className="text-lg font-semibold mb-1 flex items-center gap-2">
          <Upload className="h-5 w-5 text-green-500" />
          Restaurar Evento
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          Sube un archivo de backup de evento para restaurarlo. Se creara como un nuevo evento con el sufijo "(restaurado)".
          Los datos existentes no se modifican.
        </p>
        <div className="flex gap-3 flex-wrap">
          <div>
            <input ref={eventFileRef} type="file" accept=".json" className="hidden" onChange={(e) => handleFileSelect('event', e)} />
            <Button variant="outline" onClick={() => eventFileRef.current?.click()} disabled={isRestoring}>
              <FileJson className="mr-2 h-4 w-4" />
              Restaurar desde JSON
            </Button>
            <p className="text-xs text-muted-foreground mt-1">Crea evento nuevo con IDs remapeados</p>
          </div>
          <div>
            <input ref={eventDumpFileRef} type="file" accept=".sql" className="hidden" onChange={(e) => handleFileSelect('event-dump', e)} />
            <Button variant="outline" onClick={() => eventDumpFileRef.current?.click()} disabled={isRestoring}>
              <FileCode className="mr-2 h-4 w-4" />
              Restaurar desde SQL
            </Button>
            <p className="text-xs text-muted-foreground mt-1">Restaura con IDs originales (DB limpia)</p>
          </div>
        </div>
      </div>

      <Separator />

      {/* Historial de Backup */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <ScrollText className="h-5 w-5 text-amber-500" />
              Historial de Backup
            </h2>
            <p className="text-sm text-muted-foreground">
              Registro de todos los backups y restauraciones realizados
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetchLogs()}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" />
            Actualizar
          </Button>
        </div>

        {backupLogs.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              <ScrollText className="h-10 w-10 mx-auto mb-3 opacity-50" />
              <p>No hay registros de backup aun</p>
            </CardContent>
          </Card>
        ) : (
          <div className="bg-card border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left bg-muted/30">
                  <th className="p-3 font-medium">Fecha</th>
                  <th className="p-3 font-medium">Usuario</th>
                  <th className="p-3 font-medium">Accion</th>
                  <th className="p-3 font-medium">Estado</th>
                  <th className="p-3 font-medium w-8"></th>
                </tr>
              </thead>
              <tbody>
                {backupLogs.map((log) => {
                  const info = ACTION_LABELS[log.action] || { label: log.action, color: 'bg-gray-100 text-gray-700' };
                  const isError = log.action.includes('error');
                  const details = log.details || {};
                  return (
                    <Fragment key={log.id}>
                      <tr
                        className="border-b border-border/50 hover:bg-muted/30 cursor-pointer"
                        onClick={() => setExpandedLogId(expandedLogId === log.id ? null : log.id)}
                      >
                        <td className="p-3 font-mono text-xs whitespace-nowrap">{formatDateTime(log.created_at)}</td>
                        <td className="p-3 text-sm">{log.username || '-'}</td>
                        <td className="p-3">
                          <Badge className={info.color}>{info.label}</Badge>
                        </td>
                        <td className="p-3">
                          {isError ? (
                            <span className="flex items-center gap-1 text-destructive text-xs font-medium">
                              <XCircle className="h-3.5 w-3.5" /> Error
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-green-600 text-xs font-medium">
                              <CheckCircle className="h-3.5 w-3.5" /> OK
                            </span>
                          )}
                        </td>
                        <td className="p-3">
                          {expandedLogId === log.id ? (
                            <ChevronUp className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          )}
                        </td>
                      </tr>
                      {expandedLogId === log.id && Object.keys(details).length > 0 && (
                        <tr>
                          <td colSpan={5} className="bg-muted/30 px-6 py-3">
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 text-xs">
                              {Object.entries(details).map(([key, value]) => (
                                <div key={key}>
                                  <span className="font-medium text-muted-foreground">{key}: </span>
                                  <span className={key === 'error' ? 'text-destructive font-medium' : ''}>
                                    {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                                  </span>
                                </div>
                              ))}
                            </div>
                            {'error' in details && details.error ? (
                              <div className="mt-2 p-2 bg-destructive/10 rounded text-xs text-destructive border border-destructive/20">
                                <span className="font-medium">Error: </span>{String(details.error)}
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Confirmation Dialog */}
      <AlertDialog open={!!confirmDialog} onOpenChange={() => setConfirmDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmDialog?.type === 'full' ? 'Restaurar Dump Completo' :
               confirmDialog?.type === 'event-dump' ? 'Restaurar Evento desde SQL' :
               'Restaurar Evento desde JSON'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDialog?.type === 'full' ? (
                <>
                  Esta accion ejecutara el dump SQL con <strong>psql</strong>, lo que <strong>eliminara y recreara todos los datos</strong>.
                  Esta accion no se puede deshacer. ¿Desea continuar?
                </>
              ) : confirmDialog?.type === 'event-dump' ? (
                <>
                  Se ejecutara el archivo SQL directamente en la base de datos.
                  Los datos se insertaran con sus IDs originales (los duplicados se ignoraran).
                  Ideal para restaurar en una base de datos limpia. ¿Desea continuar?
                </>
              ) : (
                <>
                  Se creara un nuevo evento con los datos del backup.
                  Los cartones restaurados tendran codigos modificados (sufijo _R) para evitar conflictos.
                  ¿Desea continuar?
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRestore}
              className={confirmDialog?.type === 'full' ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''}
            >
              {confirmDialog?.type === 'full' ? 'Si, Restaurar Todo' :
               confirmDialog?.type === 'event-dump' ? 'Si, Ejecutar SQL' :
               'Si, Restaurar Evento'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
