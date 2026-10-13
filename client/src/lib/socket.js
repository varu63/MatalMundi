import { io } from 'socket.io-client';

/**
 * Shared Socket.IO client for real-time auction updates.
 *
 * Connects to the API origin: same-origin in dev (Vite dev proxy forwards
 * /socket.io to the API), or the origin of VITE_API_BASE_URL when the client
 * is served separately (e.g. static site + API service on Render).
 * Authenticated via the httpOnly `mm.token` cookie — no token handling here.
 * Bids are still placed over REST; the socket only receives price/deadline
 * broadcasts, so a dropped socket can never affect correctness.
 */
let socket = null;

const API_BASE = import.meta.env.VITE_API_BASE_URL;
const SOCKET_URL = API_BASE && /^https?:\/\//i.test(API_BASE) ? new URL(API_BASE).origin : '/';

export function getSocket() {
  if (!socket) {
    socket = io(SOCKET_URL, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
    });
  }
  return socket;
}

export function joinAuctionRoom(auctionId) {
  if (auctionId) getSocket().emit('auction:join', auctionId);
}

export function leaveAuctionRoom(auctionId) {
  if (auctionId) getSocket().emit('auction:leave', auctionId);
}
