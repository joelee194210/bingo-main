import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Play,
  Pause,
  RotateCcw,
  Trophy,
  Shuffle,
  Volume2,
  VolumeX,
  CheckCircle,
  Loader2,
  FileText,
} from 'lucide-react';
import {
  getGame,
  startGame,
  pauseGame,
  resumeGame,
  callBall,
  callRandomBall,
  finishGame,
  resetGame,
  replayGame,
  downloadGameReportPDF,
} from '@/services/api';
import { toast } from 'sonner';
import { useGameSocket } from '@/hooks/useGameSocket';
import { GAME_TYPE_LABELS, STATUS_LABELS, type Winner, type GameReport } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
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

const COLUMNS = ['B', 'I', 'N', 'G', 'O'] as const;

export default function GamePlay() {
  const { id } = useParams<{ id: string }>();
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [lastCalledBall, setLastCalledBall] = useState<number | null>(null);
  const [winners, setWinners] = useState<Winner[]>([]);
  const [showWinnerModal, setShowWinnerModal] = useState(false);
  const [gameReport, setGameReport] = useState<GameReport | null>(null);
  const [showReportModal, setShowReportModal] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'finish' | 'reset' | null>(null);

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    return () => {
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close();
      }
    };
  }, []);

  // A3: Socket.IO reemplaza polling — actualizaciones en tiempo real
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['game', id],
    queryFn: () => getGame(Number(id)),
    enabled: !!id,
    // Sin refetchInterval — el socket maneja las actualizaciones
  });

  const gameState = data?.data;

  const handleSocketGameUpdate = useCallback((socketData: unknown) => {
    queryClient.setQueryData(['game', id], { success: true, data: socketData });
  }, [id, queryClient]);

  const playSound = useCallback((ball: number) => {
    if (!soundEnabled) return;
    try {
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') ctx.resume();

      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      oscillator.frequency.value = 440 + (ball * 5);
      oscillator.type = 'sine';
      gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);

      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.3);
    } catch {
      // Silently ignore audio errors
    }
  }, [soundEnabled]);

  const handleSocketBallCalled = useCallback((result: any) => {
    if (result?.ball) {
      setLastCalledBall(result.ball);
      playSound(result.ball);
    }
    // Refetch para tener el estado completo actualizado
    refetch();
  }, [refetch, playSound]);

  const handleSocketWinnerFound = useCallback((socketWinners: any[]) => {
    if (socketWinners?.length > 0) {
      setWinners(socketWinners);
      setShowWinnerModal(true);
    }
  }, []);

  useGameSocket({
    gameId: id ? Number(id) : undefined,
    onGameUpdate: handleSocketGameUpdate,
    onBallCalled: handleSocketBallCalled,
    onWinnerFound: handleSocketWinnerFound,
  });

  // Derivar última balota del estado del servidor como fallback
  const displayedLastBall = lastCalledBall ?? (gameState?.calledBalls?.length ? gameState.calledBalls[gameState.calledBalls.length - 1] : null);

  // Mutations
  const startMutation = useMutation({
    mutationFn: () => startGame(Number(id)),
    onSuccess: () => refetch(),
  });

  const pauseMutation = useMutation({
    mutationFn: () => pauseGame(Number(id)),
    onSuccess: () => refetch(),
  });

  const resumeMutation = useMutation({
    mutationFn: () => resumeGame(Number(id)),
    onSuccess: () => refetch(),
  });

  const callBallMutation = useMutation({
    mutationFn: (ball: number) => callBall(Number(id), ball),
    onSuccess: (response) => {
      if (response.success && response.data) {
        setLastCalledBall(response.data.ball);
      }
    },
  });

  const callRandomMutation = useMutation({
    mutationFn: () => callRandomBall(Number(id)),
    onSuccess: (response) => {
      if (response.success && response.data) {
        setLastCalledBall(response.data.ball);
      }
    },
  });

  const resetMutation = useMutation({
    mutationFn: () => resetGame(Number(id)),
    onSuccess: () => {
      setLastCalledBall(null);
      setWinners([]);
      refetch();
    },
  });

  const replayMutation = useMutation({
    mutationFn: () => replayGame(Number(id)),
    onSuccess: (response) => {
      if (response.success && response.data) {
        toast.success('Nuevo juego creado');
        navigate(`/games/${response.data.id}`);
      }
    },
    onError: () => {
      toast.error('Error al crear nuevo juego');
    },
  });

  const finishMutation = useMutation({
    mutationFn: () => finishGame(Number(id)),
    onSuccess: (response) => {
      if (response.success && response.data) {
        if (response.data.report) {
          setGameReport(response.data.report);
          setShowReportModal(true);
        }
      }
      refetch();
    },
  });

  const handleDownloadPdf = async () => {
    if (!id) return;
    setDownloadingPdf(true);
    try {
      const blob = await downloadGameReportPDF(Number(id));
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `reporte_juego_${id}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error descargando PDF:', error);
      toast.error('Error al descargar el reporte PDF');
    } finally {
      setDownloadingPdf(false);
    }
  };

  const formatDuration = (seconds: number | null): string => {
    if (!seconds) return '--';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  const getColumn = (num: number): string => {
    if (num <= 15) return 'B';
    if (num <= 30) return 'I';
    if (num <= 45) return 'N';
    if (num <= 60) return 'G';
    return 'O';
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10 rounded-lg" />
          <div className="space-y-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-6">
                <Skeleton className="h-16 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!gameState) {
    return (
      <Card className="border-destructive/50">
        <CardContent className="pt-6 text-center text-destructive">
          Juego no encontrado
        </CardContent>
      </Card>
    );
  }

  const calledSet = new Set(gameState.calledBalls);
  const isPlaying = gameState.status === 'in_progress';
  const isPaused = gameState.status === 'paused';
  const isFinished = gameState.status === 'completed' || gameState.status === 'cancelled';

  const getStatusBadge = () => {
    if (isPlaying) return <Badge variant="success">{STATUS_LABELS[gameState.status]}</Badge>;
    if (isPaused) return <Badge variant="warning">{STATUS_LABELS[gameState.status]}</Badge>;
    if (isFinished) return <Badge variant="secondary">{STATUS_LABELS[gameState.status]}</Badge>;
    return <Badge variant="info">{STATUS_LABELS[gameState.status]}</Badge>;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="shrink-0" asChild>
            <Link to="/games">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h2 className="text-xl sm:text-2xl font-bold">
              {gameState.name || GAME_TYPE_LABELS[gameState.gameType]}
            </h2>
            <p className="text-muted-foreground text-sm">
              {GAME_TYPE_LABELS[gameState.gameType]} • {gameState.isPracticeMode ? 'Modo Práctica' : 'Modo Real'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {getStatusBadge()}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSoundEnabled(!soundEnabled)}
            title={soundEnabled ? 'Silenciar' : 'Activar sonido'}
          >
            {soundEnabled ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-2xl sm:text-3xl font-bold text-blue-600">{gameState.calledBalls.length}</p>
            <p className="text-xs sm:text-sm text-muted-foreground">Balotas Llamadas</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-2xl sm:text-3xl font-bold text-purple-600">{75 - gameState.calledBalls.length}</p>
            <p className="text-xs sm:text-sm text-muted-foreground">Balotas Restantes</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-2xl sm:text-3xl font-bold text-green-600">{gameState.activeCards.toLocaleString()}</p>
            <p className="text-xs sm:text-sm text-muted-foreground">Cartones Activos</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-2xl sm:text-3xl font-bold text-yellow-600">{gameState.winnerCards.length}</p>
            <p className="text-xs sm:text-sm text-muted-foreground">Ganadores</p>
          </CardContent>
        </Card>
      </div>

      {/* Last Called Ball */}
      {displayedLastBall && (
        <Card>
          <CardContent className="py-8 flex items-center justify-center">
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-2">Última balota</p>
              <div className={`bingo-ball bingo-ball-${getColumn(displayedLastBall)} w-16 h-16 sm:w-24 sm:h-24 text-2xl sm:text-4xl animate-bounce-slow`}>
                {displayedLastBall}
              </div>
              <p className="mt-2 text-lg font-semibold">
                {getColumn(displayedLastBall)}-{displayedLastBall}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Controls */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-3 justify-center">
            {gameState.status === 'pending' && (
              <Button variant="success" onClick={() => startMutation.mutate()} disabled={startMutation.isPending}>
                {startMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                Iniciar Juego
              </Button>
            )}

            {isPlaying && (
              <>
                <Button
                  size="lg"
                  onClick={() => callRandomMutation.mutate()}
                  disabled={callRandomMutation.isPending}
                >
                  {callRandomMutation.isPending ? (
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  ) : (
                    <Shuffle className="mr-2 h-5 w-5" />
                  )}
                  {callRandomMutation.isPending ? 'Llamando...' : 'Llamar Balota'}
                </Button>
                <Button variant="warning" onClick={() => pauseMutation.mutate()} disabled={pauseMutation.isPending}>
                  <Pause className="mr-2 h-4 w-4" /> Pausar
                </Button>
              </>
            )}

            {isPaused && (
              <Button variant="success" onClick={() => resumeMutation.mutate()} disabled={resumeMutation.isPending}>
                <Play className="mr-2 h-4 w-4" /> Reanudar
              </Button>
            )}

            {(isPlaying || isPaused) && (
              <>
                <Button
                  variant="secondary"
                  onClick={() => setConfirmAction('finish')}
                  disabled={finishMutation.isPending}
                >
                  <CheckCircle className="mr-2 h-4 w-4" /> Finalizar
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => setConfirmAction('reset')}
                  disabled={resetMutation.isPending}
                >
                  <RotateCcw className="mr-2 h-4 w-4" /> Reiniciar
                </Button>
              </>
            )}

            {isFinished && (
              <>
                <Button
                  variant="outline"
                  onClick={handleDownloadPdf}
                  disabled={downloadingPdf}
                >
                  {downloadingPdf ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <FileText className="mr-2 h-4 w-4" />
                  )}
                  Descargar Reporte
                </Button>
                <Button
                  onClick={() => replayMutation.mutate()}
                  disabled={replayMutation.isPending}
                >
                  {replayMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="mr-2 h-4 w-4" />
                  )}
                  Jugar de Nuevo
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Ball Board + History (side by side on TV screens) */}
      <div className="grid grid-cols-1 2xl:grid-cols-3 gap-6">
        <Card className="2xl:col-span-2">
          <CardHeader>
            <CardTitle>Tablero de Balotas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {COLUMNS.map((column) => {
                const start = column === 'B' ? 1 : column === 'I' ? 16 : column === 'N' ? 31 : column === 'G' ? 46 : 61;
                const balls = Array.from({ length: 15 }, (_, i) => start + i);

                return (
                  <div key={column} className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                    <div className={`bingo-ball bingo-ball-${column} w-8 h-8 sm:w-10 sm:h-10 text-base sm:text-lg`}>
                      {column}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {balls.map((ball) => {
                        const isCalled = calledSet.has(ball);
                        return (
                          <button
                            key={ball}
                            onClick={() => {
                              if (isPlaying && !isCalled) {
                                callBallMutation.mutate(ball);
                              }
                            }}
                            disabled={!isPlaying || isCalled || callBallMutation.isPending}
                            className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full font-bold text-xs sm:text-sm transition-all ${
                              isCalled
                                ? `bingo-ball-${column} text-white shadow-md`
                                : 'bg-muted text-muted-foreground hover:bg-muted/80'
                            } ${isPlaying && !isCalled ? 'cursor-pointer hover:scale-110' : 'cursor-default'}`}
                          >
                            {ball}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Called Balls History */}
        {gameState.calledBalls.length > 0 && (
          <Card className="2xl:col-span-1">
            <CardHeader>
              <CardTitle>Historial ({gameState.calledBalls.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1.5 sm:gap-2 max-h-[300px] sm:max-h-none 2xl:max-h-[500px] overflow-y-auto 2xl:overflow-y-auto">
                {gameState.calledBalls.map((ball, index) => (
                  <div
                    key={ball}
                    className={`bingo-ball bingo-ball-${getColumn(ball)} w-8 h-8 sm:w-10 sm:h-10 text-xs sm:text-sm`}
                    title={`#${index + 1}: ${getColumn(ball)}-${ball}`}
                  >
                    {ball}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Winner Modal */}
      <Dialog open={showWinnerModal} onOpenChange={setShowWinnerModal}>
        <DialogContent className="text-center">
          <DialogHeader>
            <div className="text-6xl mb-4">🎉</div>
            <DialogTitle className="text-2xl">
              ¡{winners.length > 1 ? 'Ganadores!' : 'Ganador!'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 my-4">
            {winners.map((winner) => (
              <div key={winner.cardId} className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-900 rounded-lg p-4">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Trophy className="text-yellow-500 h-6 w-6" />
                  <span className="font-bold text-xl font-mono">{winner.serial}</span>
                </div>
                <p className="text-sm text-muted-foreground">No. de control: {winner.cardNumber}</p>
                <p className="text-sm text-muted-foreground">Código: <span className="font-mono font-bold">{winner.cardCode}</span></p>
                {winner.buyerName && (
                  <p className="text-sm text-muted-foreground mt-1">{winner.buyerName}</p>
                )}
                <p className="text-xs text-muted-foreground mt-2">{winner.winningPattern}</p>
              </div>
            ))}
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button
              variant="outline"
              onClick={handleDownloadPdf}
              disabled={downloadingPdf}
              className="w-full"
            >
              {downloadingPdf ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <FileText className="mr-2 h-4 w-4" />
              )}
              {downloadingPdf ? 'Descargando...' : 'Descargar Reporte PDF'}
            </Button>
            <Button onClick={() => setShowWinnerModal(false)} className="w-full">
              Continuar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm Action Dialog */}
      <AlertDialog open={confirmAction !== null} onOpenChange={(open) => { if (!open) setConfirmAction(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction === 'finish' ? '¿Finalizar el juego?' : '¿Reiniciar el juego?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction === 'finish'
                ? 'El juego se marcará como completado y se generará un reporte.'
                : 'Se perderán todas las balotas llamadas y el juego volverá al estado inicial.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className={confirmAction !== 'finish' ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''}
              onClick={() => {
                if (confirmAction === 'finish') {
                  finishMutation.mutate();
                } else {
                  resetMutation.mutate();
                }
                setConfirmAction(null);
              }}
            >
              {confirmAction === 'finish' ? 'Finalizar' : 'Reiniciar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Report Modal */}
      <Dialog open={showReportModal} onOpenChange={setShowReportModal}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader className="text-center">
            <div className="text-5xl mb-3">📋</div>
            <DialogTitle className="text-2xl">Reporte del Juego</DialogTitle>
            {gameReport && <p className="text-muted-foreground text-sm">{gameReport.event_name}</p>}
          </DialogHeader>

          {gameReport && (
            <>
              {/* Info General */}
              <div className="bg-muted rounded-lg p-4 mb-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Tipo de Juego:</span>
                    <span className="ml-2 font-semibold">{gameReport.game_type_label}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Modo:</span>
                    <span className="ml-2 font-semibold">
                      {gameReport.is_practice_mode ? 'Práctica' : 'Real'}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Balotas Llamadas:</span>
                    <span className="ml-2 font-semibold">{gameReport.total_balls_called}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Duración:</span>
                    <span className="ml-2 font-semibold">{formatDuration(gameReport.duration_seconds)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Inicio:</span>
                    <span className="ml-2 font-semibold">
                      {gameReport.started_at ? new Date(gameReport.started_at).toLocaleString() : '--'}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Fin:</span>
                    <span className="ml-2 font-semibold">
                      {gameReport.finished_at ? new Date(gameReport.finished_at).toLocaleString() : '--'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Ganadores */}
              {gameReport.winners.length > 0 && (
                <div className="mb-4">
                  <h4 className="font-semibold mb-3 flex items-center gap-2">
                    <Trophy className="text-yellow-500 h-5 w-5" />
                    Cartones Ganadores ({gameReport.winners.length})
                  </h4>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {gameReport.winners.map((winner) => (
                      <div key={winner.id} className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-900 rounded-lg p-3">
                        <div className="flex justify-between items-center">
                          <div>
                            <span className="font-bold font-mono">{winner.serial}</span>
                            <span className="ml-2 text-xs text-muted-foreground">Control: {winner.card_number} ({winner.card_code})</span>
                          </div>
                          <Badge variant="warning" className="text-xs">
                            {winner.balls_to_win} balotas
                          </Badge>
                        </div>
                        {winner.buyer_name && (
                          <p className="text-sm text-muted-foreground mt-1">{winner.buyer_name}</p>
                        )}
                        <p className="text-xs text-muted-foreground">{winner.winning_pattern}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Historial de Balotas */}
              <div className="mb-4">
                <h4 className="font-semibold mb-3">
                  Orden de Balotas (Certificación)
                </h4>
                <div className="bg-muted rounded-lg p-3 max-h-48 overflow-y-auto">
                  <div className="flex flex-wrap gap-1">
                    {gameReport.ball_history.map((entry) => (
                      <div
                        key={entry.call_order}
                        className={`bingo-ball bingo-ball-${entry.ball_column} w-8 h-8 text-xs`}
                        title={`#${entry.call_order}: ${entry.ball_column}-${entry.ball_number} (${new Date(entry.called_at).toLocaleTimeString()})`}
                      >
                        {entry.ball_number}
                      </div>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  * El orden de las balotas está certificado para validación oficial
                </p>
              </div>
            </>
          )}

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={handleDownloadPdf}
              disabled={downloadingPdf}
              className="flex-1"
            >
              {downloadingPdf ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <FileText className="mr-2 h-4 w-4" />
              )}
              {downloadingPdf ? 'Descargando...' : 'Descargar PDF'}
            </Button>
            <Button onClick={() => setShowReportModal(false)} className="flex-1">
              Cerrar
            </Button>
          </DialogFooter>

          {gameReport && (
            <p className="text-xs text-muted-foreground text-center mt-2">
              Reporte generado: {new Date(gameReport.report_generated_at).toLocaleString()}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
