import { io } from 'socket.io-client';

/**
 * Shared Socket.IO client for real-time auction updates.
 *
 * Same-origin connection (Vite dev proxy forwards /socket.io to the API),
 * authenticated via the httpOnly `mm.token` cookie — no token handling here.
 * Bids are still placed over REST; the socket only receives price/deadline
 * broadcasts, so a dropped socket can never affect correctness.
 */
let socket = null;

export function getSocket() {
  if (!socket) {
    socket = io('/', {
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
