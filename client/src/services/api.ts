import axios from 'axios';
import type {
  ApiResponse,
  BingoEvent,
  BingoCard,
  BingoGame,
  GameState,
  DashboardStats,
  GameType,
  CallBallResult,
  Winner,
  GameReport,
  GameWinner,
  FinishGameResult,
} from '../types';

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

// Interceptor: redirigir a login en 401
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && !error.config?.url?.includes('/auth/')) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Dashboard
export const getDashboard = () =>
  api.get<ApiResponse<DashboardStats>>('/dashboard').then(r => r.data);

// Events
export const getEvents = () =>
  api.get<ApiResponse<BingoEvent[]>>('/events').then(r => r.data);

export const getEvent = (id: number) =>
  api.get<ApiResponse<BingoEvent>>(`/events/${id}`).then(r => r.data);

export const createEvent = (data: { name: string; description?: string; use_free_center?: boolean }) =>
  api.post<ApiResponse<BingoEvent>>('/events', data).then(r => r.data);

export const updateEvent = (id: number, data: Partial<BingoEvent>) =>
  api.put<ApiResponse<BingoEvent>>(`/events/${id}`, data).then(r => r.data);

export const deleteEvent = (id: number) =>
  api.delete<ApiResponse<void>>(`/events/${id}`).then(r => r.data);

export const getEventStats = (id: number) =>
  api.get<ApiResponse<{ event: BingoEvent; cards: { total: number; sold: number; available: number }; games: { total: number; completed: number; active: number } }>>(`/events/${id}/stats`).then(r => r.data);

// Cards
export const getCards = (params: { event_id?: number; page?: number; limit?: number; is_sold?: boolean }) =>
  api.get<ApiResponse<BingoCard[]>>('/cards', { params }).then(r => r.data);

export const getCard = (id: number) =>
  api.get<ApiResponse<BingoCard>>(`/cards/${id}`).then(r => r.data);

export const generateCards = (eventId: number, quantity: number) =>
  api.post<ApiResponse<{ generated: number; duplicatesAvoided: number; generationTime: number }>>('/cards/generate', { event_id: eventId, quantity }).then(r => r.data);

export const getGenerationProgress = (eventId: number) =>
  api.get<ApiResponse<{ total: number; generated: number; status: string } | null>>(`/cards/generate/progress/${eventId}`).then(r => r.data);

export const validateCard = (cardCode: string, validationCode: string) =>
  api.post<ApiResponse<BingoCard>>('/cards/validate', { card_code: cardCode, validation_code: validationCode }).then(r => r.data);

export const verifyEventCards = (eventId: number) =>
  api.post<ApiResponse<{ success: boolean; totalChecked: number; duplicatesFound: number; issues: unknown[] }>>(`/cards/verify/${eventId}`).then(r => r.data);

export const sellCard = (id: number, data: { buyer_name?: string; buyer_phone?: string }) =>
  api.put<ApiResponse<BingoCard>>(`/cards/${id}/sell`, data).then(r => r.data);

export const searchCard = (code: string) =>
  api.get<ApiResponse<BingoCard>>(`/cards/search/${code}`).then(r => r.data);

// Games
export const getGames = (params?: { event_id?: number; status?: string }) =>
  api.get<ApiResponse<BingoGame[]>>('/games', { params }).then(r => r.data);

export const getGame = (id: number) =>
  api.get<ApiResponse<GameState>>(`/games/${id}`).then(r => r.data);

export const createGame = (data: { event_id: number; game_type: GameType; name?: string; is_practice_mode?: boolean; prize_description?: string; custom_pattern?: number[][] }) =>
  api.post<ApiResponse<GameState>>('/games', data).then(r => r.data);

export const startGame = (id: number) =>
  api.post<ApiResponse<GameState>>(`/games/${id}/start`).then(r => r.data);

export const pauseGame = (id: number) =>
  api.post<ApiResponse<GameState>>(`/games/${id}/pause`).then(r => r.data);

export const resumeGame = (id: number) =>
  api.post<ApiResponse<GameState>>(`/games/${id}/resume`).then(r => r.data);

export const callBall = (id: number, ball: number) =>
  api.post<ApiResponse<CallBallResult>>(`/games/${id}/call`, { ball }).then(r => r.data);

export const callRandomBall = (id: number) =>
  api.post<ApiResponse<CallBallResult>>(`/games/${id}/call-random`).then(r => r.data);

export const finishGame = (id: number) =>
  api.post<ApiResponse<FinishGameResult>>(`/games/${id}/finish`).then(r => r.data);

export const cancelGame = (id: number) =>
  api.post<ApiResponse<GameState>>(`/games/${id}/cancel`).then(r => r.data);

export const resetGame = (id: number) =>
  api.post<ApiResponse<GameState>>(`/games/${id}/reset`).then(r => r.data);

export const getGameWinners = (id: number) =>
  api.get<ApiResponse<Winner[]>>(`/games/${id}/winners`).then(r => r.data);

export const getGameStats = (id: number) =>
  api.get<ApiResponse<{ totalBallsCalled: number; remainingBalls: number; ballsByColumn: Record<string, number[]>; winnerCount: number; duration: number | null }>>(`/games/${id}/stats`).then(r => r.data);

// Reports
export const getGameReport = (gameId: number) =>
  api.get<ApiResponse<GameReport>>(`/reports/game/${gameId}`).then(r => r.data);

export const downloadGameReportPDF = (gameId: number) =>
  api.get(`/reports/game/${gameId}/pdf`, { responseType: 'blob' }).then(r => r.data);

export const getReportWinners = (gameId: number) =>
  api.get<ApiResponse<GameWinner[]>>(`/reports/game/${gameId}/winners`).then(r => r.data);

export const getBallHistory = (gameId: number) =>
  api.get<ApiResponse<{ ball_number: number; ball_column: string; call_order: number; called_at: string }[]>>(`/reports/game/${gameId}/balls`).then(r => r.data);

export const getEventWinners = (eventId: number) =>
  api.get<ApiResponse<GameWinner[]>>(`/reports/event/${eventId}/winners`).then(r => r.data);

export const getRecentWinners = (limit?: number) =>
  api.get<ApiResponse<(GameWinner & { game_name: string; event_name: string })[]>>('/reports/recent-winners', { params: { limit } }).then(r => r.data);

// Export
export const downloadCardsCSV = (eventId: number) =>
  api.get(`/export/csv/${eventId}`, { responseType: 'blob' }).then(r => r.data);

export default api;
