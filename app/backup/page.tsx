'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  backupAllStagesToServer,
  listServerClassrooms,
  restoreClassroomFromServer,
  deleteServerClassroom,
  type ServerClassroomSummary,
} from '@/lib/utils/server-backup';

type BackupResult = Awaited<ReturnType<typeof backupAllStagesToServer>>;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function BackupPage() {
  const [backupRunning, setBackupRunning] = useState(false);
  const [backupResult, setBackupResult] = useState<BackupResult | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);

  const [serverList, setServerList] = useState<ServerClassroomSummary[] | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; msg: string } | null>(null);

  const refreshList = useCallback(async () => {
    setListLoading(true);
    try {
      const list = await listServerClassrooms();
      setServerList(list);
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  async function runBackup() {
    setBackupRunning(true);
    setBackupResult(null);
    setBackupError(null);
    try {
      const r = await backupAllStagesToServer();
      setBackupResult(r);
      await refreshList();
    } catch (e) {
      setBackupError(e instanceof Error ? e.message : String(e));
    } finally {
      setBackupRunning(false);
    }
  }

  async function restoreOne(id: string, name: string) {
    setRestoringId(id);
    try {
      const r = await restoreClassroomFromServer(id);
      if (r.ok) {
        setToast({
          kind: 'success',
          msg: `Restored "${r.name ?? name}" to this browser (${r.scenes ?? 0} scenes). It's now in your local history.`,
        });
      } else {
        setToast({ kind: 'error', msg: `Restore failed: ${r.error ?? 'unknown'}` });
      }
    } finally {
      setRestoringId(null);
    }
  }

  async function deleteOne(id: string, name: string) {
    if (!confirm(`Delete "${name}" from server? This cannot be undone.`)) return;
    setDeletingId(id);
    try {
      const ok = await deleteServerClassroom(id);
      if (ok) {
        setToast({ kind: 'success', msg: `Deleted "${name}" from server.` });
        await refreshList();
      } else {
        setToast({ kind: 'error', msg: `Delete failed for "${name}".` });
      }
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="min-h-screen p-6 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-950">
      <div className="max-w-4xl mx-auto space-y-8">
        <header>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            Backup &amp; Restore
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Manage your classroom snapshots. The server keeps the canonical copy; your browser
            holds an editable local copy.
          </p>
        </header>

        {toast && (
          <div
            className={
              toast.kind === 'success'
                ? 'p-3 rounded-lg bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800 text-sm text-green-800 dark:text-green-200'
                : 'p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-sm text-red-800 dark:text-red-200'
            }
          >
            {toast.msg}
          </div>
        )}

        {/* ──────── Backup section ──────── */}
        <section className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm p-6 border border-slate-200 dark:border-slate-800">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-1">
            Backup browser classrooms to server
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
            Reads every classroom from this browser&apos;s local storage and uploads them to the
            server. Auto-save runs in the background after every classroom edit; this button is
            your manual full snapshot.
          </p>
          <button
            onClick={runBackup}
            disabled={backupRunning}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold py-2.5 px-6 rounded-lg transition"
          >
            {backupRunning ? 'Backing up…' : 'Backup all to server'}
          </button>

          {backupError && (
            <div className="mt-4 p-3 rounded bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-sm text-red-800 dark:text-red-200">
              <strong>Error:</strong> {backupError}
            </div>
          )}
          {backupResult && (
            <div className="mt-4 p-3 rounded bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800 text-sm text-green-800 dark:text-green-200">
              Backup complete — {backupResult.ok} of {backupResult.total} stages saved
              {backupResult.failed > 0 && (
                <span className="text-amber-700 dark:text-amber-300">
                  {' '}
                  ({backupResult.failed} skipped — empty or failed)
                </span>
              )}
              .
            </div>
          )}
        </section>

        {/* ──────── Restore section ──────── */}
        <section className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm p-6 border border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Server-side classrooms ({serverList?.length ?? '…'})
            </h2>
            <button
              onClick={refreshList}
              disabled={listLoading}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-40"
            >
              {listLoading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
            Open in classroom view, restore to this browser&apos;s history, or delete from server.
          </p>

          {!serverList ? (
            <div className="text-sm text-slate-500">Loading…</div>
          ) : serverList.length === 0 ? (
            <div className="text-sm text-slate-500 italic">
              No classrooms on server yet. Click &quot;Backup all to server&quot; above to upload
              what&apos;s in this browser.
            </div>
          ) : (
            <ul className="space-y-3">
              {serverList.map((c) => (
                <li
                  key={c.id}
                  className="border border-slate-200 dark:border-slate-700 rounded-lg p-3 flex items-start justify-between gap-4 flex-col sm:flex-row"
                >
                  <div className="flex-1 min-w-0">
                    <div
                      className="font-semibold text-slate-900 dark:text-slate-100 truncate"
                      title={c.name}
                    >
                      {c.name}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                      <span className="font-mono">{c.id}</span>
                      <span>·</span>
                      <span>{c.sceneCount} scenes</span>
                      <span>·</span>
                      <span>{formatBytes(c.sizeBytes)}</span>
                      <span>·</span>
                      <span>{formatDate(c.createdAt)}</span>
                    </div>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <a
                      href={`/classroom/${c.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white font-medium"
                    >
                      Open
                    </a>
                    <button
                      onClick={() => restoreOne(c.id, c.name)}
                      disabled={restoringId === c.id}
                      className="text-xs px-3 py-1.5 rounded border border-blue-600 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 dark:text-blue-400 font-medium disabled:opacity-40"
                    >
                      {restoringId === c.id ? 'Restoring…' : 'Restore'}
                    </button>
                    <button
                      onClick={() => deleteOne(c.id, c.name)}
                      disabled={deletingId === c.id}
                      className="text-xs px-3 py-1.5 rounded border border-red-300 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 dark:border-red-700 dark:text-red-400 font-medium disabled:opacity-40"
                    >
                      {deletingId === c.id ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className="text-xs text-slate-500 dark:text-slate-500 border-t border-slate-200 dark:border-slate-800 pt-4">
          <strong>Bookmark this URL:</strong> /backup — keep it handy. Auto-save runs after every
          classroom edit; the nightly cron tars the server volume to{' '}
          <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">
            /home/rony/backups/openmaic/
          </code>{' '}
          with 14-day retention.
        </footer>
      </div>
    </div>
  );
}
