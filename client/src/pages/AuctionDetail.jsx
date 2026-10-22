import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Clock,
  Gavel,
  History,
  MapPin,
  Scale,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import { endpoints, handleError } from '../lib/api';
import { paise, kg, dateTime, countdown, imageUrl } from '../lib/format';
import { getSocket, joinAuctionRoom, leaveAuctionRoom } from '../lib/socket';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import StatusBadge from '../components/StatusBadge';
import Spinner from '../components/Spinner';

export default function AuctionDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [auction, setAuction] = useState(null);
  const [bids, setBids] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [bidInput, setBidInput] = useState('');
  const [bidding, setBidding] = useState(false);
  const [error, setError] = useState('');
  const [outbidNotice, setOutbidNotice] = useState(false);
  const [activeImage, setActiveImage] = useState(0);
  const [, setTick] = useState(0);
  const lastBidCount = useRef(0);

  const isOwner =
    auction && user && String(auction.sellerId ?? auction.seller?.id) === String(user.id);
  const isLive = auction?.status === 'ACTIVE' && auction?.canBid;
  const remaining = auction ? countdown(auction.endAt) : '';

  const images = useMemo(() => {
    if (!auction?.images) return [];
    const list = [
      auction.images.front,
      auction.images.back,
      auction.images.left,
      auction.images.right,
    ];
    if (auction.images.weightEvidence) list.push(auction.images.weightEvidence);
    return [...list, ...(auction.images.additional || [])].filter((i) => i?.url);
  }, [auction]);

  const refresh = useCallback(async () => {
    try {
      const [aRes, bRes] = await Promise.all([
        endpoints.auctions.get(id),
        endpoints.auctions.bids(id, { limit: 25 }),
      ]);
      setAuction(aRes.data.data.auction);
      setBids(bRes.data.data || []);
      setNotFound(false);
    } catch (err) {
      if (err?.response?.status === 404) setNotFound(true);
    }
  }, [id]);

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  // Real-time: watch this auction's room; refresh state on every broadcast.
  useEffect(() => {
    if (!id) return undefined;
    const socket = getSocket();
    joinAuctionRoom(id);

    const onUpdate = () => refresh();
    const onOutbid = (payload) => {
      if (String(payload?.auctionId) !== String(id)) return;
      setOutbidNotice(true);
      toast.warning('You have been outbid on this auction');
      refresh();
    };
    socket.on('auction:bid', onUpdate);
    socket.on('auction:extended', onUpdate);
    socket.on('auction:state', onUpdate);
    socket.on('auction:ended', onUpdate);
    socket.on('auction:outbid', onOutbid);

    return () => {
      leaveAuctionRoom(id);
      socket.off('auction:bid', onUpdate);
      socket.off('auction:extended', onUpdate);
      socket.off('auction:state', onUpdate);
      socket.off('auction:ended', onUpdate);
      socket.off('auction:outbid', onOutbid);
    };
  }, [id, refresh, toast]);

  // Local countdown; when it lapses on a live auction, ask the server for the
  // final state (the server owns the timer — this never awards anything).
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (auction?.status === 'ACTIVE' && auction?.endAt && !countdown(auction.endAt)) {
      refresh();
    }
  }, [remaining, auction, refresh]);

  useEffect(() => {
    if (auction && auction.bidCount > lastBidCount.current && lastBidCount.current > 0) {
      setOutbidNotice(false);
    }
    if (auction) lastBidCount.current = auction.bidCount;
  }, [auction]);

  const minNextPaise = auction?.minNextBidPaise ?? 0;

  const submitBid = async (e) => {
    e.preventDefault();
    setError('');
    const rupees = Number(bidInput);
    if (!rupees || rupees <= 0) {
      setError('Enter a bid amount.');
      return;
    }
    setBidding(true);
    try {
      await endpoints.auctions.placeBid(id, { bidPerKgPaise: Math.round(rupees * 100) });
      toast.success('Bid placed');
      setBidInput('');
      setOutbidNotice(false);
      await refresh();
    } catch (err) {
      const msg = handleError(err);
      setError(msg);
      toast.error(msg);
      await refresh(); // resync with the authoritative state
    } finally {
      setBidding(false);
    }
  };

  if (loading) return <Spinner center label="Loading auction…" />;
  if (notFound || !auction) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-24 text-center">
        <Gavel className="mx-auto h-12 w-12 text-ink-300" />
        <h1 className="page-title mt-4">Auction not found</h1>
        <p className="text-ink-500">It may have been removed or was never approved.</p>
        <Link to="/auctions" className="btn-primary mt-6 inline-flex">
          Browse auctions
        </Link>
      </div>
    );
  }

  const concluded = [
    'ENDED',
    'AWAITING_PAYMENT',
    'AWAITING_PICKUP',
    'COMPLETED',
    'NO_BIDS',
    'CANCELLED',
  ].includes(auction.status);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <button
        onClick={() => navigate(-1)}
        className="mb-4 flex items-center gap-1 text-sm text-ink-500 hover:text-ink-800"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <div className="grid gap-6 lg:grid-cols-[1fr,380px]">
        {/* Left: material */}
        <div className="space-y-6">
          <div className="card overflow-hidden">
            <div className="aspect-[16/10] bg-ink-100">
              {images[activeImage] ? (
                <img
                  src={imageUrl(images[activeImage])}
                  alt={auction.materialType}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-ink-400">
                  <Gavel className="h-12 w-12" />
                </div>
              )}
            </div>
            {images.length > 1 && (
              <div className="flex gap-2 overflow-x-auto p-3 scrollbar-thin">
                {images.map((img, i) => (
                  <button
                    key={img.url || i}
                    onClick={() => setActiveImage(i)}
                    className={`h-16 w-16 shrink-0 overflow-hidden rounded-lg ring-2 transition ${i === activeImage ? 'ring-brand-500' : 'ring-transparent hover:ring-ink-300'}`}
                  >
                    <img src={imageUrl(img)} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="card p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-xl font-bold text-ink-900">
                  {auction.materialType} —{' '}
                  {auction.quantityKg != null ? kg(auction.quantityKg) : ''}
                </h1>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-500">
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" /> {auction.location?.city},{' '}
                    {auction.location?.state}
                  </span>
                  <span className="flex items-center gap-1">
                    <Scale className="h-3.5 w-3.5" /> {auction.condition?.toLowerCase()} · grade{' '}
                    {auction.qualityGrade}
                  </span>
                  <span className="font-mono text-xs">{auction.auctionNumber}</span>
                </p>
              </div>
              <StatusBadge status={auction.status} />
            </div>
            {auction.inspectionNotes && (
              <p className="mt-4 rounded-lg bg-ink-50 p-3 text-sm text-ink-600">
                {auction.inspectionNotes}
              </p>
            )}
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Info label="Starting price" value={`${paise(auction.startingPricePerKgPaise)}/kg`} />
              <Info
                label="Min. increment"
                value={
                  auction.minIncrementType === 'PERCENT'
                    ? `${auction.minIncrementValue}%`
                    : `${paise(auction.minIncrementValue)}/kg`
                }
              />
              <Info
                label="Bids"
                value={`${auction.bidCount} (${auction.bidderCount} bidder${auction.bidderCount === 1 ? '' : 's'})`}
              />
              <Info label="Extensions" value={auction.extensionCount || 0} />
            </dl>
            {isOwner && auction.reservePricePerKgPaise != null && (
              <p className="mt-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <ShieldCheck className="h-4 w-4" /> Reserve price (only you can see this):{' '}
                <strong>{paise(auction.reservePricePerKgPaise)}/kg</strong>
              </p>
            )}
          </div>

          <div className="card p-6">
            <h2 className="flex items-center gap-2 font-semibold text-ink-900">
              <History className="h-4 w-4 text-brand-600" /> Bid history
            </h2>
            {bids.length === 0 ? (
              <p className="mt-4 text-sm text-ink-500">No bids yet — be the first.</p>
            ) : (
              <ul className="mt-4 divide-y divide-ink-100">
                {bids.map((b) => (
                  <li key={b.id} className="flex items-center justify-between py-2.5 text-sm">
                    <span className="flex items-center gap-2">
                      <span
                        className={`font-semibold ${b.isOwn ? 'text-brand-700' : 'text-ink-800'}`}
                      >
                        {paise(b.bidPerKgPaise)}/kg
                      </span>
                      {b.isOwn ? (
                        <span className="chip bg-brand-100 text-brand-700">You</span>
                      ) : null}
                      <StatusBadge status={b.status} />
                    </span>
                    <span className="text-xs text-ink-400">{dateTime(b.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-ink-400">
              Bidder identities stay private until the auction ends.
            </p>
          </div>
        </div>

        {/* Right: live bid box */}
        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <div className="card overflow-hidden">
            <div
              className={`p-5 ${isLive ? 'bg-gradient-to-br from-brand-600 to-brand-700 text-white' : 'bg-ink-900 text-white'}`}
            >
              <p className="text-xs uppercase tracking-wide opacity-80">
                {auction.currentHighestBidPerKgPaise ? 'Current highest bid' : 'Starting price'}
              </p>
              <p className="mt-1 text-3xl font-bold">
                {paise(auction.currentHighestBidPerKgPaise ?? auction.startingPricePerKgPaise)}
                <span className="text-base font-medium">/kg</span>
              </p>
              {isLive ? (
                <p className="mt-2 flex items-center gap-1.5 text-sm">
                  <Clock className="h-4 w-4" />
                  Ends in <span className="font-mono font-semibold">{remaining || '…'}</span>
                </p>
              ) : (
                <p className="mt-2 text-sm opacity-90">
                  {auction.status === 'SCHEDULED'
                    ? `Starts ${dateTime(auction.startAt)}`
                    : concluded
                      ? 'Bidding closed'
                      : 'Not open for bidding'}
                </p>
              )}
            </div>

            <div className="space-y-4 p-5">
              {concluded && (
                <div className="rounded-lg border border-ink-200 bg-ink-50 p-3 text-sm">
                  {auction.winnerSelectionReason === 'WINNER' && (
                    <p className="flex items-center gap-2 font-medium text-brand-700">
                      <TrendingUp className="h-4 w-4" /> Sold at{' '}
                      {paise(auction.winningBidPerKgPaise)}/kg
                    </p>
                  )}
                  {auction.winnerSelectionReason === 'NO_BIDS' && (
                    <p className="text-ink-600">Ended with no bids.</p>
                  )}
                  {auction.winnerSelectionReason === 'RESERVE_NOT_MET' && (
                    <p className="text-ink-600">
                      Ended — the best bid did not reach the seller's reserve price.
                    </p>
                  )}
                  {['CANCELLED', 'PAYMENT_FAILED'].includes(auction.winnerSelectionReason) && (
                    <p className="text-ink-600">This auction was cancelled.</p>
                  )}
                </div>
              )}

              {isLive && !isOwner && (
                <>
                  {outbidNotice && (
                    <p className="flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 p-2.5 text-xs text-orange-800">
                      <AlertTriangle className="h-4 w-4" /> You've been outbid — place a higher bid
                      to stay in front.
                    </p>
                  )}
                  {user ? (
                    <form onSubmit={submitBid} className="space-y-3">
                      <div>
                        <label className="label" htmlFor="auctiondetail-your-bid-kg">Your bid (₹/kg)</label>
                        <input id="auctiondetail-your-bid-kg"
                          type="number"
                          className="input"
                          min={minNextPaise / 100}
                          step="0.01"
                          value={bidInput}
                          onChange={(e) => setBidInput(e.target.value)}
                          placeholder={`${minNextPaise / 100}`}
                        />
                        <p className="mt-1 text-xs text-ink-500">
                          Minimum next bid: <strong>{paise(minNextPaise)}/kg</strong> · total at
                          this price for {kg(auction.quantityKg)} ≈{' '}
                          {paise(Math.round(minNextPaise * (auction.quantityKg || 0)))}
                        </p>
                      </div>
                      {error && <p className="text-sm text-red-600">{error}</p>}
                      <button type="submit" className="btn-primary w-full" disabled={bidding}>
                        {bidding ? 'Placing bid…' : 'Place bid'}
                      </button>
                    </form>
                  ) : (
                    <Link to="/login" className="btn-primary block w-full text-center">
                      Log in to bid
                    </Link>
                  )}
                </>
              )}

              {isLive && isOwner && (
                <p className="rounded-lg bg-ink-50 p-3 text-sm text-ink-600">
                  This is your auction — you can't bid on your own lot. Watch the bids come in live.
                </p>
              )}
            </div>
          </div>

          <div className="card p-5 text-xs text-ink-500">
            <p className="flex items-center gap-1.5 font-medium text-ink-700">
              <ShieldCheck className="h-4 w-4 text-brand-600" /> Fair bidding
            </p>
            <ul className="mt-2 list-inside list-disc space-y-1">
              <li>All bids are validated on the server against the live auction state.</li>
              <li>The timer is controlled by the server — refreshing never resets it.</li>
              <li>If the reserve price isn't reached, the lot is not awarded.</li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div>
      <dt className="text-xs text-ink-400">{label}</dt>
      <dd className="font-medium text-ink-800">{value}</dd>
    </div>
  );
}
