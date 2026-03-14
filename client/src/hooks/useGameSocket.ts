import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import type { CallBallResult, Winner } from '@/types';

interface UseGameSocketOptions {
  gameId: number | undefined;
  onGameUpdate: (data: unknown) => void;
  onBallCalled: (data: CallBallResult) => void;
  onWinnerFound: (data: Winner[]) => void;
}

export function useGameSocket({ gameId, onGameUpdate, onBallCalled, onWinnerFound }: UseGameSocketOptions) {
  const socketRef = useRef<Socket | null>(null);
  const onGameUpdateRef = useRef(onGameUpdate);
  const onBallCalledRef = useRef(onBallCalled);
  const onWinnerFoundRef = useRef(onWinnerFound);

  // Mantener refs actualizadas sin re-crear el socket
  useEffect(() => {
    onGameUpdateRef.current = onGameUpdate;
    onBallCalledRef.current = onBallCalled;
    onWinnerFoundRef.current = onWinnerFound;
  });

  useEffect(() => {
    if (!gameId) return;

    // Usar withCredentials para enviar cookie httpOnly en vez de token en memoria
    const socket = io(window.location.origin, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join-game', gameId);
    });

    socket.on('game-update', (data) => onGameUpdateRef.current(data));
    socket.on('ball-called', (data) => onBallCalledRef.current(data));
    socket.on('winner-found', (data) => onWinnerFoundRef.current(data));

    socket.on('connect_error', (err) => {
      console.warn('Socket connection error:', err.message);
    });

    return () => {
      socket.emit('leave-game', gameId);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [gameId]);

  return socketRef;
}
