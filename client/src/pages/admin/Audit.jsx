import { useCallback, useEffect, useState } from 'react';
import { ScrollText } from 'lucide-react';
import { endpoints, handleError } from '../../lib/api';
import { dateTime, titleCase } from '../../lib/format';
import { useToast } from '../../context/ToastContext';
import Pagination from '../../components/Pagination';
import Spinner from '../../components/Spinner';

export default function AdminAudit() {
  const toast = useToast();
  const [data, setData] = useState({ data: [], meta: {} });
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [resourceType, setResourceType] = useState('');
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);

  const loadList = useCallback(() => {
    setLoading(true);
    endpoints.admin
      .audit({
        page,
        limit: 15,
        action: action || undefined,
        resourceType: resourceType || undefined,
      })
      .then((r) => setData({ data: r.data.data, meta: r.data.meta }))
      .catch((err) => {
        toast.error(handleError(err));
        setData({ data: [], meta: {} });
      })
      .finally(() => setLoading(false));
  }, [action, page, resourceType, toast]);

  useEffect(loadList, [loadList]);

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-semibold text-ink-900">
              <ScrollText className="h-4 w-4 text-brand-600" /> Audit log
            </h2>
            <p className="mt-0.5 text-xs text-ink-500">
              Every privileged action, with the actor, the IP it came from and the before/after
              state.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="input w-48"
              placeholder="Filter by action…"
              value={action}
              onChange={(e) => {
                setAction(e.target.value.trim().toUpperCase());
                setPage(1);
              }}
            />
            <input
              className="input w-48"
              placeholder="Filter by resource…"
              value={resourceType}
              onChange={(e) => {
                setResourceType(e.target.value.trim());
                setPage(1);
              }}
            />
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <Spinner center />
        ) : data.data.length === 0 ? (
          <p className="p-10 text-center text-sm text-ink-500">No audit entries match.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-ink-50 text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">Actor</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Resource</th>
                  <th className="px-4 py-3">IP</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {data.data.map((row) => (
                  <tr key={row.id} className="align-top hover:bg-ink-50/50">
                    <td className="px-4 py-3 text-xs text-ink-500">{dateTime(row.createdAt)}</td>
                    <td className="px-4 py-3">
                      {row.actor?.name || row.actor || 'System'}
                      {row.actorRole && (
                        <span className="block text-xs text-ink-500">{row.actorRole}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="chip bg-ink-100 text-ink-700">{titleCase(row.action)}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-600">
                      {row.resourceType}
                      {row.resourceId && (
                        <span className="block font-mono text-ink-400">{row.resourceId}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-500">{row.ip || '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        className="btn-secondary px-2 py-1 text-xs"
                        onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                      >
                        {expanded === row.id ? 'Hide' : 'Details'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} pages={data.meta.totalPages || 1} onChange={setPage} />
      </div>

      {expanded && (
        <div className="card p-5">
          {(() => {
            const row = data.data.find((r) => r.id === expanded);
            if (!row) return null;
            return (
              <div className="space-y-3">
                <h3 className="font-semibold text-ink-900">{titleCase(row.action)}</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <pre className="overflow-x-auto rounded-lg bg-ink-50 p-3 text-xs text-ink-700">
                    {JSON.stringify(row.before ?? {}, null, 2)}
                  </pre>
                  <pre className="overflow-x-auto rounded-lg bg-ink-50 p-3 text-xs text-ink-700">
                    {JSON.stringify(row.after ?? {}, null, 2)}
                  </pre>
                </div>
                {row.userAgent && (
                  <p className="break-all text-xs text-ink-400">User agent: {row.userAgent}</p>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
