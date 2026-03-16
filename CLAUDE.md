# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Plataforma de administración de juegos de Bingo Americano (75 números). Monorepo con npm workspaces: `client/` (React SPA) y `server/` (Express API). The codebase and UI are in Spanish.

## Commands

```bash
# Install all dependencies (root, client, server)
npm install

# Run both client and server concurrently
npm run dev

# Run individually
npm run dev:client    # Vite dev server on :5173
npm run dev:server    # Express + Socket.IO on :3001 (tsx watch)

# Initialize PostgreSQL database
npm run db:init

# Build
npm run build         # Builds both workspaces (tsc + vite build)
```

No test framework is configured.

## Architecture

### Server (`server/src/`)

- **Express + Socket.IO** API with JWT auth (Bearer tokens)
- **PostgreSQL** via `pg` (Pool). Connection: `postgresql://slacker@localhost:5432/bingo`, schema at `server/src/database/schema.sql`. Designed for 1M+ cards with optimized indexes.
- **Routes** (`routes/`): auth, events, cards, games, dashboard, export, reports. All routes except `/api/auth` require authentication.
- **Services** (`services/`): `gameEngine.ts` (game lifecycle, ball calling, winner detection), `cardGenerator.ts` (card generation), `cardVerifier.ts` (winner verification), `authService.ts` (JWT, bcrypt), `reportService.ts`, `exportService.ts` (PDF/PNG via pdfkit+canvas).
- **Auth middleware** (`middleware/auth.ts`): `authenticate`, `requireRole`, `requirePermission`. Extends Express Request with `req.user` and `req.jwtPayload`.
- **Roles**: admin, moderator, seller, viewer — permissions defined in `types/auth.ts` (`ROLE_PERMISSIONS`).
- Each route handler uses a connection pool via `getDatabase()`.
- Socket.IO emits real-time game events: `game-update`, `ball-called`, `winner-found` to room `game-{id}`.

### Client (`client/src/`)

- **React 18 + TypeScript + Vite**, styled with **Tailwind CSS + shadcn/ui** (Radix primitives, `components/ui/`).
- **Path alias**: `@/*` maps to `./src/*`.
- **State**: React Query (`@tanstack/react-query`) for server state, `AuthContext` for auth.
- **Routing**: `react-router-dom` v7. `ProtectedRoute` wraps routes requiring auth or specific permissions.
- **API client** (`services/api.ts`): Axios instance with base URL `/api` (proxied by Vite to :3001).
- **Key pages**: Dashboard, Events (list/detail), Cards (list/generate/validate), Games (list/play), Users management.

### Domain Model

- **Event** → has many **Cards** (generated with unique numbers, hash-verified for no duplicates) and **Games**
- **Game** types: horizontal_line, vertical_line, diagonal, blackout, four_corners, x_pattern, custom
- **Game lifecycle**: pending → in_progress → paused/completed/cancelled
- Bingo card: 5x5 grid, columns B(1-15), I(16-30), N(31-45), G(46-60), O(61-75). Optional FREE center.
- Cards have `card_code` (5-char alphanumeric) and `validation_code` for verification.
- Cards can be in practice mode (all cards participate) or real mode (only sold cards).
- PostgreSQL triggers auto-update event card counts on insert/sell.
