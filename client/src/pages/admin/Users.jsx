import { useCallback, useEffect, useState } from 'react';
import { Search, ShieldCheck, ShieldOff, Users as UsersIcon } from 'lucide-react';
import { endpoints, handleError } from '../../lib/api';
import { dateTime, paise } from '../../lib/format';
import { useToast } from '../../context/ToastContext';
import StatusBadge from '../../components/StatusBadge';
import Pagination from '../../components/Pagination';
import Spinner from '../../components/Spinner';

const STATUS_OPTIONS = [
  { key: '', label: 'All statuses' },
  { key: 'ACTIVE', label: 'Active' },
  { key: 'PENDING_VERIFICATION', label: 'Pending verification' },
  { key: 'SUSPENDED', label: 'Suspended' },
];

export default function AdminUsers() {
  const toast = useToast();
  const [data, setData] = useState({ data: [], meta: {} });
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [confirmId, setConfirmId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [summary, setSummary] = useState(null);

  const loadList = useCallback(() => {
    setLoading(true);
    endpoints.admin
      .users({ page, limit: 10, status: status || undefined, search: search || undefined })
      .then((r) => setData({ data: r.data.data, meta: r.data.meta }))
      .catch((err) => {
        toast.error(handleError(err));
        setData({ data: [], meta: {} });
      })
      .finally(() => setLoading(false));
  }, [page, status, search, toast]);

  useEffect(loadList, [loadList]);

  const openSummary = useCallback(
    async (id) => {
      if (summary?.id === id) {
        setSummary(null);
        return;
      }
      try {
        const res = await endpoints.admin.userSummary(id);
        setSummary({ id, ...res.data.data.summary });
      } catch (err) {
        toast.error(handleError(err));
        setSummary(null);
      }
    },
    [summary, toast]
  );

  const setUserStatus = useCallback(
    async (user, nextStatus) => {
      setBusyId(user.id);
      try {
        const res = await endpoints.admin.userStatus(user.id, nextStatus);
        toast.success(res.data.message || `Account ${nextStatus.toLowerCase()}`);
        setConfirmId(null);
        loadList();
      } catch (err) {
        toast.error(handleError(err));
      } finally {
        setBusyId(null);
      }
    },
    [loadList, toast]
  );

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-semibold text-ink-900">
              <UsersIcon className="h-4 w-4 text-brand-600" /> Users
            </h2>
            <p className="mt-0.5 text-xs text-ink-500">
              Suspend abusive accounts or reactivate them. Admin accounts cannot be suspended here.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setPage(1);
                setSearch(e.target.search.value);
              }}
              className="relative"
            >
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-ink-400" />
              <input
                name="search"
                defaultValue={search}
                placeholder="Search name or email…"
                className="input w-56 pl-9"
              />
            </form>
            <select
              className="input w-auto"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s.key || 'all'} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <Spinner center />
        ) : data.data.length === 0 ? (
          <p className="p-10 text-center text-sm text-ink-500">No users match.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-ink-50 text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Joined</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {data.data.map((u) => (
                  <tr key={u.id} className="align-top hover:bg-ink-50/50">
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        className="text-left"
                        onClick={() => openSummary(u.id)}
                      >
                        <span className="block font-semibold text-ink-900">{u.name}</span>
                        <span className="block text-xs text-ink-500">{u.email}</span>
                      </button>
                      {summary?.id === u.id && (
                        <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg bg-ink-50 p-3 text-xs text-ink-600 sm:grid-cols-4">
                          <span>
                            Orders <strong className="text-ink-900">{summary.orders}</strong>
                          </span>
                          <span>
                            Pending{' '}
                            <strong className="text-ink-900">{summary.pendingOrders}</strong>
                          </span>
                          <span>
                            Lots <strong className="text-ink-900">{summary.submissions}</strong>
                          </span>
                          <span>
                            Spend{' '}
                            <strong className="text-ink-900">{paise(summary.lifetimeSpendPaise)}</strong>
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-ink-600">{u.phone || '—'}</td>
                    <td className="px-4 py-3">
                      <span className="chip bg-ink-100 text-ink-700">{u.role}</span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={u.accountStatus} />
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-500">{dateTime(u.createdAt)}</td>
                    <td className="px-4 py-3 text-right">
                      {u.role === 'ADMIN' ? (
                        <span className="text-xs text-ink-400">Protected</span>
                      ) : confirmId === u.id ? (
                        <span className="flex items-center justify-end gap-2">
                          <button
                            className="btn-secondary px-2 py-1 text-xs"
                            onClick={() => setConfirmId(null)}
                          >
                            Cancel
                          </button>
                          <button
                            className="btn-danger px-2 py-1 text-xs"
                            disabled={busyId === u.id}
                            onClick={() =>
                              setUserStatus(u, u.accountStatus === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED')
                            }
                          >
                            Confirm
                          </button>
                        </span>
                      ) : (
                        <button
                          className="btn-secondary inline-flex items-center gap-1 px-2 py-1 text-xs"
                          disabled={busyId === u.id}
                          onClick={() => setConfirmId(u.id)}
                        >
                          {u.accountStatus === 'SUSPENDED' ? (
                            <>
                              <ShieldCheck className="h-3.5 w-3.5" /> Reactivate
                            </>
                          ) : (
                            <>
                              <ShieldOff className="h-3.5 w-3.5" /> Suspend
                            </>
                          )}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pages={data.meta.totalPages || 1} onChange={setPage} />
      </div>
    </div>
  );
}
