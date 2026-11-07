import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { ChevronLeft, ChevronRight, RefreshCw, Trash2 } from 'lucide-react';
import { getAccountDeletionRequests } from '@/lib/accountDeletion.functions';
import { Button } from '@/components/ui/button';
import PageLoader from '@/components/PageLoader';

export default function AccountDeletionRequests() {
  const fetchRequests = useServerFn(getAccountDeletionRequests);
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState('pending');
  const query = useQuery({ queryKey: ['admin-account-deletions', page, status], queryFn: () => fetchRequests({ data: { page, status } }), refetchInterval: 60000 });
  if (query.isPending) return <PageLoader />;
  return <div className="p-4 md:p-6 text-foreground">
    <header className="flex flex-wrap items-center justify-between gap-3 mb-5">
      <h1 className="text-2xl font-semibold flex items-center gap-2"><Trash2 className="w-5 h-5 text-destructive" />Deletion requests</h1>
      <Button variant="outline" size="icon" aria-label="Refresh deletion requests" title="Refresh requests" onClick={() => void query.refetch()} disabled={query.isFetching}><RefreshCw className="w-4 h-4" /></Button>
    </header>
    <div className="flex gap-1 border-b border-border pb-3 mb-4">
      {['pending', 'cancelled', 'all'].map(filter => <Button key={filter} variant={status === filter ? 'default' : 'ghost'} onClick={() => { setStatus(filter); setPage(0); }} className="capitalize" aria-pressed={status === filter}>{filter}</Button>)}
    </div>
    {query.error ? <p role="alert" className="text-destructive">{query.error.message}</p> : <>
      {!query.data?.length && <p className="py-8 text-muted-foreground">No {status === 'all' ? '' : status} deletion requests.</p>}
      <div className="space-y-3">{query.data?.map(row => <article key={row.user_id} className="rounded-lg border border-border p-4 space-y-3">
        <div className="flex flex-wrap justify-between gap-2">
          <div className="min-w-0"><h2 className="font-medium break-all">{row.username || row.email || 'Account'}</h2><p className="text-xs text-muted-foreground break-all">{row.email}</p></div>
          <span className="text-xs text-muted-foreground">{row.completed_at ? 'Completed' : row.cancelled_at ? 'Cancelled' : Date.parse(row.delete_after) <= Date.now() ? 'Awaiting cleanup' : 'Recovery period'}</span>
        </div>
        <dl className="text-sm space-y-2">
          <div><dt className="text-muted-foreground">Reason</dt><dd>{row.reason}</dd></div>
          {row.feedback && <div><dt className="text-muted-foreground">Feedback</dt><dd className="whitespace-pre-wrap break-words">{row.feedback}</dd></div>}
          <div><dt className="text-muted-foreground">Requested</dt><dd>{new Date(row.requested_at).toLocaleString()}</dd></div>
          <div><dt className="text-muted-foreground">Deletion deadline</dt><dd>{new Date(row.delete_after).toLocaleString()}</dd></div>
        </dl>
      </article>)}</div>
      <div className="flex justify-between items-center mt-5">
        <Button variant="outline" size="icon" aria-label="Previous page" disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft className="w-4 h-4" /></Button>
        <span className="text-sm text-muted-foreground">Page {page + 1}</span>
        <Button variant="outline" size="icon" aria-label="Next page" disabled={(query.data?.length || 0) < 50} onClick={() => setPage(page + 1)}><ChevronRight className="w-4 h-4" /></Button>
      </div>
    </>}
  </div>;
}