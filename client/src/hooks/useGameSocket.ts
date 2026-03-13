import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import type { CallBallResult, Winner } from '@/types';
import { getAuthToken } from '@/contexts/AuthContext';

interface UseGameSocketOptions {
  gameId: number | undefined;
  onGameUpdate: (data: unknown) => void;
  onBallCalled: (data: CallBallResult) => void;
  onWinnerFound: (data: Winner[]) => void;
}

export function useGameSocket({ gameId, onGameUpdate, onBallCalled, onWinnerFound }: UseGameSocketOptions) {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!gameId) return;

    const token = getAuthToken();
    if (!token) return;

    const socket = io(window.location.origin, {
      auth: { token },
      transports: ['websocket', 'polling'],
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join-game', gameId);
    });

    socket.on('game-update', onGameUpdate);
    socket.on('ball-called', onBallCalled);
    socket.on('winner-found', onWinnerFound);

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
