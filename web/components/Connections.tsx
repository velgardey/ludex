"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { ArrowClockwise } from "@phosphor-icons/react";
import { LudexError } from "@ludex/client";
import type { CatalogHit } from "@ludex/domain";
import {
  createConnectionsClient,
  type ConnectionObservation,
  type ConnectionsOverview,
  type ConnectionsRequest,
  type ImportJob,
  type ImportRow,
  type ImportPreview,
  type SteamPreviewObservation,
} from "../../packages/client/src/connections.ts";
import styles from "./Connections.module.css";

type Props = {
  client: ConnectionsRequest;
  signedIn: boolean;
  sessionKey: string | null;
  catalog?: CatalogHit[];
  onSignIn: () => void;
};

type ActiveJob = {
  pollUrl: string;
  value: ImportJob;
  owner: string;
};

type ImportFilter = "all" | "needs-review" | "matched" | "needs-episode" | "accepted" | "failed";
const IMPORT_PAGE_SIZE = 100;
type ConnectionsApi = ReturnType<typeof createConnectionsClient>;

const MAX_CSV_BYTES = 5 * 1024 * 1024;

export function Connections(props: Props) {
  return <ConnectionsContent key={props.sessionKey ?? "guest"} {...props} />;
}

function ConnectionsContent({ client, signedIn, sessionKey, catalog = [], onSignIn }: Props) {
  const api = useMemo(() => createConnectionsClient(client), [client]);
  const [overview, setOverview] = useState<ConnectionsOverview | null>(null);
  const [observations, setObservations] = useState<ConnectionObservation[]>([]);
  const [imports, setImports] = useState<Awaited<ReturnType<typeof api.readImports>>>([]);
  const [loadedOwner, setLoadedOwner] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [source, setSource] = useState<"csv" | "letterboxd">("csv");
  const [csv, setCsv] = useState("");
  const [draftOwner, setDraftOwner] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [previewOwner, setPreviewOwner] = useState<string | null>(null);
  const [confirmRows, setConfirmRows] = useState(false);
  const [importFilter, setImportFilter] = useState<ImportFilter>("all");
  const [importPage, setImportPage] = useState(0);
  const [importError, setImportError] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null);
  const [jobError, setJobError] = useState("");
  const [pollVersion, setPollVersion] = useState(0);
  const [steamId64, setSteamId64] = useState("");
  const [steamRows, setSteamRows] = useState<SteamPreviewObservation[]>([]);
  const [steamNextOffset, setSteamNextOffset] = useState<number | null>(null);
  const [steamLoadedId, setSteamLoadedId] = useState("");
  const [steamBusy, setSteamBusy] = useState(false);
  const [steamError, setSteamError] = useState("");
  const requestVersion = useRef(0);
  const steamRequestVersion = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    if (!signedIn || !sessionKey) return false;
    const version = ++requestVersion.current;
    setLoading(true);
    setLoadError("");
    try {
      const [nextOverview, nextObservations, nextImports] = await Promise.all([
        api.readConnections(),
        api.readObservations(),
        api.readImports(),
      ]);
      if (version !== requestVersion.current) return false;
      setOverview(nextOverview);
      setObservations(nextObservations);
      setImports(nextImports);
      setLoadedOwner(sessionKey);
      return true;
    } catch (error) {
      if (version === requestVersion.current)
        setLoadError(messageFor(error, "Connections could not be loaded."));
      return false;
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [api, sessionKey, signedIn]);

  useEffect(() => {
    let active = true;
    if (signedIn && sessionKey)
      void Promise.resolve().then(() => {
        if (active) void refresh();
      });
    return () => {
      active = false;
    };
  }, [refresh, signedIn, sessionKey]);

  const activePollUrl = activeJob?.pollUrl;
  useEffect(() => {
    if (!signedIn || !sessionKey || !activePollUrl) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const result = await api.readImportJob(activePollUrl);
        if (cancelled) return;
        setActiveJob((current) => current?.pollUrl === activePollUrl ? { ...current, value: result } : current);
        if (result.status === "queued" || result.status === "running") {
          timer = setTimeout(() => void poll(), 1100);
        } else {
          void refresh();
        }
      } catch (error) {
        if (!cancelled) setJobError(messageFor(error, "Import status could not be checked."));
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [activePollUrl, api, pollVersion, refresh, sessionKey, signedIn]);

  const currentOwner = signedIn && !!sessionKey && loadedOwner === sessionKey;
  const currentDraft = signedIn && !!sessionKey && draftOwner === sessionKey;
  const currentPreview =
    currentOwner && preview !== null && previewOwner === sessionKey ? preview : null;
  const currentJob =
    currentOwner && activeJob !== null && activeJob.owner === sessionKey ? activeJob : null;
  const capabilities = currentOwner ? overview?.capabilities : undefined;
  const steamCapability = capabilities?.steam;
  const steamConfigured = typeof steamCapability === "boolean" ? steamCapability : !!steamCapability?.configured;
  const steamSupported = typeof steamCapability === "boolean" ? steamCapability : !!steamCapability?.supported;
  const currentSteamRows = steamLoadedId === steamId64.trim() ? steamRows : [];
  const matchedRows = currentPreview?.rows.filter(isMatched) ?? [];
  const unmatchedRows = currentPreview?.rows.filter(needsReview) ?? [];
  const filteredRows = (currentPreview?.rows ?? []).filter((row) => matchesImportFilter(row, importFilter));
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / IMPORT_PAGE_SIZE));
  const currentPage = Math.min(importPage, pageCount - 1);
  const visibleRows = filteredRows.slice(currentPage * IMPORT_PAGE_SIZE, (currentPage + 1) * IMPORT_PAGE_SIZE);
  const firstVisible = filteredRows.length ? currentPage * IMPORT_PAGE_SIZE + 1 : 0;
  const lastVisible = Math.min(filteredRows.length, (currentPage + 1) * IMPORT_PAGE_SIZE);
  const remainingRows = Math.max(0, filteredRows.length - lastVisible);

  async function loadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    setImportError("");
    if (file.size > MAX_CSV_BYTES) {
      setImportError("This file is larger than 5 MiB. Choose a smaller CSV export.");
      event.currentTarget.value = "";
      return;
    }
    try {
      const text = await file.text();
      setCsv(text);
      setDraftOwner(sessionKey);
      if (/letterboxd/i.test(file.name)) setSource("letterboxd");
      setPreview(null);
      setPreviewOwner(null);
      setConfirmRows(false);
      setImportPage(0);
      setImportFilter("all");
    } catch {
      setImportError("The selected file could not be read. Try another CSV file.");
    }
  }

  async function makePreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sessionKey || !signedIn || !currentOwner || !csv.trim()) return;
    setImportBusy(true);
    setImportError("");
    setPreview(null);
    setConfirmRows(false);
    setImportPage(0);
    setImportFilter("all");
    try {
      const result = await api.previewImport(source, csv);
      setPreview(result);
      setPreviewOwner(sessionKey);
      setDraftOwner(sessionKey);
    } catch (error) {
      setImportError(messageFor(error, "The CSV could not be previewed."));
    } finally {
      setImportBusy(false);
    }
  }

  function changeSource(next: "csv" | "letterboxd") {
    setSource(next);
    setPreview(null);
    setPreviewOwner(null);
    setConfirmRows(false);
    setImportPage(0);
    setImportFilter("all");
    setImportError("");
  }

  async function matchImportRow(row: ImportRow, choice: { titleId: string; episodeId?: string }) {
    if (!currentPreview || importBusy) return;
    setImportBusy(true);
    setImportError("");
    try {
      const result = await api.matchImportRow(currentPreview.id, row.id, choice);
      setPreview((current) => current ? {
        ...current,
        rows: current.rows.map((item) => item.id === row.id ? { ...item, ...result } : item),
      } : current);
      setConfirmRows(false);
    } catch (error) {
      setImportError(messageFor(error, "This row could not be matched."));
      throw new Error(messageFor(error, "This row could not be matched."));
    } finally {
      setImportBusy(false);
    }
  }

  async function commitPreview() {
    if (!currentPreview || !sessionKey || !confirmRows || !matchedRows.length || importBusy)
      return;
    setImportBusy(true);
    setImportError("");
    setJobError("");
    try {
      const response = await api.commitImport(currentPreview.id);
      const value = objectValue(response);
      const pollUrl = value?.pollUrl;
      const jobId = value?.jobId;
      if (!value || typeof pollUrl !== "string" || typeof jobId !== "string") {
        throw new Error("The server did not return an import job to track.");
      }
      setActiveJob({
        owner: sessionKey,
        pollUrl,
        value: {
          jobId,
          status: typeof value.status === "string" ? value.status : "queued",
          accepted: numberValue(value.accepted),
          remaining: numberValue(value.remaining),
          rows: Array.isArray(value.rows) ? value.rows : currentPreview.rows,
        },
      });
      setConfirmRows(false);
      setPollVersion((current) => current + 1);
    } catch (error) {
      setImportError(messageFor(error, "The import could not be queued."));
    } finally {
      setImportBusy(false);
    }
  }

  async function previewSteam(offset?: number) {
    if (!currentOwner || !steamId64.trim() || steamBusy) return;
    const request = ++steamRequestVersion.current;
    const requestedId = steamId64.trim();
    setSteamBusy(true);
    setSteamError("");
    if (offset === undefined) {
      setSteamRows([]);
      setSteamNextOffset(null);
      setSteamLoadedId("");
    }
    try {
      const result = await api.previewSteam(requestedId, offset);
      if (request !== steamRequestVersion.current) return;
      setSteamLoadedId(requestedId);
      setSteamRows((current) => offset === undefined ? result.observations : [...current, ...result.observations]);
      setSteamNextOffset(result.truncated && typeof result.nextOffset === "number" ? result.nextOffset : null);
    } catch (error) {
      if (request === steamRequestVersion.current)
        setSteamError(messageFor(error, "Steam could not be previewed."));
    } finally {
      if (request === steamRequestVersion.current) setSteamBusy(false);
    }
  }

  async function confirmObservation(
    observationId: string,
    choice: { titleId: string; media: "movie" | "show" | "game"; episodeId?: string; date?: string },
    steam = false,
  ) {
    try {
      await api.confirmObservation(observationId, choice);
      if (steam) setSteamRows((current) => current.filter((row) => row.id !== observationId));
      else await refresh();
    } catch (error) {
      throw new Error(messageFor(error, "This capture could not be confirmed."));
    }
  }

  return (
    <section className={styles.panel} aria-label="Connections and imports">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>YOUR SOURCES · YOUR CALL</p>
          <h2>Bring your history with you.</h2>
          <p className={styles.intro}>
            Preview every match before anything reaches your private journal.
          </p>
        </div>
        {signedIn ? (
          <button
            className={styles.refresh}
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            aria-label="Refresh connections and imports"
          >
            <ArrowClockwise size={15} aria-hidden="true" /> Refresh
          </button>
        ) : null}
      </header>

      {!signedIn ? (
        <div className={styles.signIn}>
          <strong>Your sources stay private to your account.</strong>
          <p>Sign in to review captures, preview an import, or see past imports.</p>
          <button className={styles.primary} type="button" onClick={onSignIn}>
            Sign in to continue
          </button>
        </div>
      ) : (
        <>
          {loadError ? (
            <div className={styles.error} role="alert">
              <span>{loadError}</span>
              {loadError.includes("session ended") ? (
                <button type="button" onClick={onSignIn}>Sign in again</button>
              ) : null}
              <button type="button" onClick={() => void refresh()}>
                Try again
              </button>
            </div>
          ) : null}

          {capabilities ? (
            <div className={styles.sourceGrid} aria-label="Source availability">
              <SourceCard
                name="CSV import"
                detail={capabilities.csv ? "Ready · preview before importing" : "Not available in this environment"}
                active={!!capabilities.csv}
              />
              <SourceCard
                name="Letterboxd"
                detail={capabilities.letterboxd ? "CSV export supported" : "Letterboxd import is not configured"}
                active={!!capabilities.letterboxd}
              />
              <SourceCard
                name="Steam"
                detail={!steamConfigured ? "Steam API key is not configured" : !steamSupported ? "Steam import is not supported here" : "Manual Steam ID preview · confirm games one by one"}
                active={steamConfigured && steamSupported}
              />
              <SourceCard
                name="Netflix capture"
                detail={capabilities.netflixCapture ? "Browser captures wait here for review" : "Capture is not available"}
                active={!!capabilities.netflixCapture}
              />
              <SourceCard
                name="RetroAchievements"
                detail={capabilities.retroachievements ? "Connection available" : "Not supported yet"}
                active={!!capabilities.retroachievements}
              />
              <SourceCard
                name="Trakt"
                detail={capabilities.trakt ? "Connection available" : "Not supported yet"}
                active={!!capabilities.trakt}
              />
            </div>
          ) : (
            <p className={styles.status} role="status">Checking which sources are available…</p>
          )}

          {!currentOwner && loading ? (
            <p className={styles.status} role="status">Loading your private connections…</p>
          ) : null}

          {currentOwner ? (
            <div className={styles.sections}>
              <section className={styles.reviewSection} aria-labelledby="capture-heading">
                <div className={styles.sectionHeading}>
                  <div>
                    <p className={styles.eyebrow}>INBOX</p>
                    <h3 id="capture-heading">Captures to review</h3>
                  </div>
                  <span className={styles.count}>{observations.length} waiting</span>
                </div>
                {!observations.length ? (
                  <p className={styles.empty}>No new captures are waiting for review.</p>
                ) : (
                  <ul className={styles.observationList}>
                    {observations.map((observation) => (
                      <ObservationReview
                        key={observation.id}
                        observation={observation}
                        catalog={catalog}
                        onConfirm={(choice) => confirmObservation(observation.id, choice)}
                      />
                    ))}
                  </ul>
                )}
              </section>

              <section className={styles.importSection} aria-labelledby="steam-heading">
                <div className={styles.sectionHeading}>
                  <div>
                    <p className={styles.eyebrow}>STEAM · MANUAL PREVIEW</p>
                    <h3 id="steam-heading">Review game history</h3>
                  </div>
                </div>
                {!steamConfigured ? (
                  <p className={styles.empty}>Steam preview is unavailable because this environment has no Steam API key configured.</p>
                ) : !steamSupported ? (
                  <p className={styles.empty}>Steam preview is not supported in this environment yet.</p>
                ) : (
                  <>
                    <form className={styles.importForm} onSubmit={(event) => { event.preventDefault(); void previewSteam(); }}>
                      <label className={styles.field}>
                        <span>Steam ID64</span>
                        <input
                          inputMode="numeric"
                          value={steamId64}
                          onChange={(event) => {
                            const next = event.currentTarget.value.replace(/\D/g, "").slice(0, 17);
                            steamRequestVersion.current++;
                            setSteamId64(next);
                            setSteamRows([]);
                            setSteamLoadedId("");
                            setSteamNextOffset(null);
                            setSteamError("");
                            setSteamBusy(false);
                          }}
                          placeholder="76561198012345678"
                          aria-describedby="steam-help"
                        />
                      </label>
                      <p id="steam-help" className={styles.fieldHint}>
                        Enter a public 17-digit Steam ID64. Ludex previews the game list; choose each catalog match yourself before adding it to your journal.
                      </p>
                      {steamError ? <p className={styles.inlineError} role="alert">{steamError}</p> : null}
                      <button className={styles.primary} type="submit" disabled={steamId64.length !== 17 || steamBusy || !currentOwner}>
                        {steamBusy ? "Loading games…" : "Preview Steam games"}
                      </button>
                    </form>
                    {currentSteamRows.length ? (
                      <>
                        <ul className={styles.previewRows}>
                          {currentSteamRows.map((row) => (
                            <SteamReview
                              key={row.id}
                              row={row}
                              catalog={catalog}
                              busy={steamBusy}
                              onConfirm={(choice) => confirmObservation(row.id, choice, true)}
                            />
                          ))}
                        </ul>
                        {steamNextOffset !== null ? (
                          <button className={styles.secondary} type="button" disabled={steamBusy} onClick={() => void previewSteam(steamNextOffset)}>
                            {steamBusy ? "Loading…" : "Load next 100 games"}
                          </button>
                        ) : null}
                      </>
                    ) : steamLoadedId === steamId64.trim() && steamLoadedId ? (
                      <p className={styles.empty}>No games were returned for this Steam account.</p>
                    ) : null}
                  </>
                )}
              </section>

              <section className={styles.importSection} aria-labelledby="import-heading">
                <div className={styles.sectionHeading}>
                  <div>
                    <p className={styles.eyebrow}>PRIVATE IMPORT</p>
                    <h3 id="import-heading">Preview a CSV</h3>
                  </div>
                </div>
                <form className={styles.importForm} onSubmit={makePreview}>
                  <div className={styles.formRow}>
                    <label className={styles.field}>
                      <span>Format</span>
                      <select
                        value={source}
                        onChange={(event) => changeSource(event.currentTarget.value as "csv" | "letterboxd")}
                        disabled={importBusy || loading}
                      >
                        <option value="csv">Generic CSV</option>
                        <option value="letterboxd">Letterboxd export</option>
                      </select>
                    </label>
                    <label className={styles.fileField}>
                      <span>Choose a CSV file</span>
                      <input
                        ref={fileInput}
                        type="file"
                        accept=".csv,text/csv"
                        onChange={(event) => void loadFile(event)}
                        disabled={importBusy || loading}
                      />
                    </label>
                  </div>
                  <label className={styles.field}>
                    <span>Or paste CSV text</span>
                    <textarea
                      value={currentDraft ? csv : ""}
                      onChange={(event) => {
                        setCsv(event.currentTarget.value);
                        setDraftOwner(sessionKey);
                        setPreview(null);
                        setPreviewOwner(null);
                        setConfirmRows(false);
                        setImportPage(0);
                        setImportFilter("all");
                      }}
                      rows={5}
                      maxLength={5 * 1024 * 1024}
                      placeholder={'title,year,media,date,rating\nMoonrise Kingdom,2012,movie,2026-09-12,8'}
                      disabled={!currentOwner || importBusy || loading}
                      aria-describedby="csv-help"
                    />
                  </label>
                  <p id="csv-help" className={styles.fieldHint}>
                    CSV is read by Ludex only to make this preview. Matching and parsing happen on the server.
                  </p>
                  {importError ? <p className={styles.inlineError} role="alert">{importError}</p> : null}
                  <button
                    className={styles.primary}
                    type="submit"
                    disabled={!currentOwner || !csv.trim() || importBusy || loading}
                  >
                    {importBusy && !currentPreview ? "Checking matches…" : "Preview matches"}
                  </button>
                </form>

                {currentPreview ? (
                  <div className={styles.preview} aria-live="polite">
                    <div className={styles.previewSummary}>
                      <div>
                        <p className={styles.eyebrow}>SERVER MATCH RESULTS</p>
                        <h4>{matchedRows.length} ready · {unmatchedRows.length} need attention · {currentPreview.rows.length} total</h4>
                      </div>
                      <button
                        type="button"
                        className={styles.textButton}
                        onClick={() => {
                          setPreview(null);
                          setPreviewOwner(null);
                          setConfirmRows(false);
                        }}
                      >
                        Clear preview
                      </button>
                    </div>
                    {!currentPreview.rows.length ? (
                      <p className={styles.empty}>No importable rows were found in this file.</p>
                    ) : (
                      <>
                        <div className={styles.reviewToolbar}>
                          <label className={styles.field}>
                            <span>Show rows</span>
                            <select value={importFilter} onChange={(event) => { setImportFilter(event.currentTarget.value as ImportFilter); setImportPage(0); }}>
                              <option value="all">All rows ({currentPreview.rows.length})</option>
                              <option value="needs-review">Needs review ({unmatchedRows.length})</option>
                              <option value="matched">Ready to import ({matchedRows.length})</option>
                              <option value="needs-episode">Episode needed ({currentPreview.rows.filter((row) => row.status === "needs-episode").length})</option>
                              <option value="accepted">Already imported ({currentPreview.rows.filter((row) => row.status === "accepted").length})</option>
                              <option value="failed">Failed or conflicted ({currentPreview.rows.filter((row) => row.status === "failed" || row.status === "conflict").length})</option>
                            </select>
                          </label>
                          <span className={styles.fieldHint}>
                            {filteredRows.length ? `Showing ${firstVisible}–${lastVisible} of ${filteredRows.length}${remainingRows ? ` · ${remainingRows} more on later pages` : ""}` : "No rows in this view."}
                          </span>
                        </div>
                        <ul className={styles.importRows}>
                          {visibleRows.map((row) => (
                            <ImportRowReview
                              key={row.id}
                              row={row}
                              catalog={catalog}
                              api={api}
                              busy={importBusy}
                              onMatch={(choice) => matchImportRow(row, choice)}
                            />
                          ))}
                        </ul>
                        {pageCount > 1 ? (
                          <nav className={styles.pagination} aria-label="Import row pages">
                            <button className={styles.textButton} type="button" disabled={currentPage === 0} onClick={() => setImportPage(currentPage - 1)}>Previous 100</button>
                            <span>Page {currentPage + 1} of {pageCount}</span>
                            <button className={styles.textButton} type="button" disabled={currentPage + 1 >= pageCount} onClick={() => setImportPage(currentPage + 1)}>Next 100</button>
                          </nav>
                        ) : null}
                      </>
                    )}
                    {matchedRows.length ? (
                      <>
                        <label className={styles.confirmLine}>
                          <input
                            type="checkbox"
                            checked={confirmRows}
                            onChange={(event) => setConfirmRows(event.currentTarget.checked)}
                            disabled={importBusy}
                          />
                          <span>I reviewed these matches. Add only matched rows to my private journal.</span>
                        </label>
                        <button
                          className={styles.primary}
                          type="button"
                          onClick={() => void commitPreview()}
                          disabled={!confirmRows || importBusy}
                        >
                          {importBusy ? "Queueing import…" : `Import all ${matchedRows.length} matched rows`}
                        </button>
                      </>
                    ) : (
                      <p className={styles.fieldHint}>Nothing will be imported until at least one row has a safe match.</p>
                    )}
                    {unmatchedRows.length ? (
                      <p className={styles.fieldHint}>Rows without a safe match stay out of your journal.</p>
                    ) : null}
                  </div>
                ) : null}
              </section>

              {currentJob ? (
                <section className={styles.jobSection} aria-labelledby="job-heading">
                  <div className={styles.sectionHeading}>
                    <div>
                      <p className={styles.eyebrow}>IMPORT JOB</p>
                      <h3 id="job-heading">{jobTitle(currentJob.value.status)}</h3>
                    </div>
                    {currentJob.value.status === "queued" || currentJob.value.status === "running" ? (
                      <span className={styles.pulse} role="status">Working</span>
                    ) : null}
                  </div>
                  {jobError ? (
                    <div className={styles.error} role="alert">
                      <span>{jobError}</span>
                      <button type="button" onClick={() => setPollVersion((version) => version + 1)}>
                        Check status again
                      </button>
                    </div>
                  ) : null}
                  <p className={styles.fieldHint}>
                    {currentJob.value.accepted} added · {currentJob.value.remaining} still unresolved
                  </p>
                  {currentJob.value.rows.length ? (
                    <ul className={styles.previewRows}>
                      {currentJob.value.rows.map((row) => (
                        <li key={row.id} className={styles.previewRow}>
                          <div><strong>{row.title}</strong><span>{mediaName(row.media)}</span></div>
                          <span className={row.status === "accepted" || row.status === "completed" ? styles.matched : styles.unmatched}>
                            {row.outcome ?? row.status}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </section>
              ) : null}

              <section className={styles.historySection} aria-labelledby="history-heading">
                <div className={styles.sectionHeading}>
                  <div>
                    <p className={styles.eyebrow}>HISTORY</p>
                    <h3 id="history-heading">Recent imports</h3>
                  </div>
                </div>
                {!imports.length ? (
                  <p className={styles.empty}>Your import history will appear here.</p>
                ) : (
                  <ul className={styles.historyList}>
                    {imports.map((item) => (
                      <li key={item.id}>
                        <span><strong>{sourceName(item.source)}</strong><small>{formatDate(item.createdAt)}</small></span>
                        <span className={styles.historyStatus}>{item.status}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function SourceCard({
  name,
  detail,
  active,
  disabled = false,
}: {
  name: string;
  detail: string;
  active: boolean;
  disabled?: boolean;
}) {
  return (
    <div className={`${styles.sourceCard} ${active ? styles.sourceActive : ""}`}>
      <div className={styles.sourceTop}>
        <span className={styles.sourceDot} aria-hidden="true" />
        <strong>{name}</strong>
      </div>
      <p>{detail}</p>
      {disabled ? <span className={styles.disabledLabel}>Setup unavailable</span> : null}
    </div>
  );
}

function ImportRowReview({
  row,
  catalog,
  api,
  busy,
  onMatch,
}: {
  row: ImportRow;
  catalog: CatalogHit[];
  api: ConnectionsApi;
  busy: boolean;
  onMatch: (choice: { titleId: string; episodeId?: string }) => Promise<void>;
}) {
  const [query, setQuery] = useState(row.title);
  const [searchActive, setSearchActive] = useState(false);
  const [titleId, setTitleId] = useState(row.matchedTitleId ?? "");
  const [episodeId, setEpisodeId] = useState(row.episodeId ?? "");
  const [searchResults, setSearchResults] = useState<CatalogHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const canEdit = row.status === "needs-match" || row.status === "needs-episode" || row.status === "matched";
  const episodeRequired = row.media === "show" && (
    row.status === "needs-episode" || !!row.episodeTitle || row.state === "completed"
  );

  useEffect(() => {
    if (!searchActive) return;
    let active = true;
    const timer = setTimeout(() => {
      if (query.trim().length < 2) {
        setSearchResults([]);
        setSearchError("");
        return;
      }
      setSearching(true);
      setSearchError("");
      void api.searchCatalog(query, row.media)
        .then((results) => {
          if (active) setSearchResults(results);
        })
        .catch((cause: unknown) => {
          if (active) setSearchError(cause instanceof Error ? cause.message : "Catalog search is unavailable.");
        })
        .finally(() => { if (active) setSearching(false); });
    }, 260);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [api, query, row.media, searchActive]);

  const results = dedupeCatalog([
    ...searchResults,
    ...catalog.filter((item) => item.media === row.media && item.title.toLowerCase().includes(query.trim().toLowerCase())),
  ]).slice(0, 8);
  const selectedTitle = results.find((item) => item.id === titleId) ?? catalog.find((item) => item.id === titleId);
  const episodes = selectedTitle?.episodes ?? [];

  return (
    <li className={styles.importReviewRow}>
      <div className={styles.importRowHeading}>
        <div>
          <strong>{row.title}</strong>
          <span>{mediaName(row.media)}{row.year ? ` · ${row.year}` : ""}{row.date ? ` · ${row.date}` : ""}{row.rating ? ` · ${row.rating}/10` : ""}</span>
        </div>
        <span className={isMatched(row) ? styles.matched : row.status === "needs-episode" ? styles.episodeNeeded : styles.unmatched}>
          {isMatched(row) ? `Matched: ${selectedTitle?.title ?? row.matchedTitleId}` : row.status === "needs-episode" ? "Episode needed" : row.status}
        </span>
      </div>
      {row.episodeTitle ? <p className={styles.fieldHint}>Episode from CSV: {row.episodeTitle}</p> : null}
      {canEdit ? (
        <div className={styles.rowMatchControls}>
          <label className={styles.field}>
            <span>Find a real Ludex catalog title</span>
            <input
              value={query}
              onFocus={() => setSearchActive(true)}
              onChange={(event) => { setSearchActive(true); setQuery(event.currentTarget.value); setTitleId(""); setEpisodeId(""); setSearchResults([]); }}
              placeholder="Search title"
            />
          </label>
          {searching ? <span className={styles.fieldHint} role="status">Searching catalog…</span> : null}
          {searchError ? <span className={styles.inlineError} role="alert">{searchError}</span> : null}
          {searchActive && query.trim().length >= 2 ? (
            <div className={styles.titleChoices} role="listbox" aria-label={`Catalog matches for ${row.title}`}>
              {results.length ? results.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={titleId === item.id}
                  className={titleId === item.id ? styles.titleSelected : ""}
                  onClick={() => { setTitleId(item.id); setEpisodeId(""); }}
                >
                  <span>{item.title}</span><small>{mediaName(item.media)} · {item.year ?? "Year unknown"}</small>
                </button>
              )) : !searching ? <p>No Ludex catalog matches. Try another title.</p> : null}
            </div>
          ) : <p className={styles.fieldHint}>Focus this field to search the real Ludex catalog. At least two characters are required.</p>}
          {row.media === "show" && titleId ? (
            <label className={styles.field}>
              <span>{episodeRequired ? "Choose the episode to import" : "Episode ID · optional for a library-only row"}</span>
              {episodes.length ? (
                <select value={episodeId} onChange={(event) => setEpisodeId(event.currentTarget.value)}>
                  <option value="">{episodeRequired ? "Choose a catalog episode" : "No episode event"}</option>
                  {episodes.map((episode) => <option key={episode.id} value={episode.id}>{episode.title || `Episode ${episode.order}`}</option>)}
                </select>
              ) : (
                <input value={episodeId} onChange={(event) => setEpisodeId(event.currentTarget.value)} placeholder="Enter the exact Ludex episode ID" />
              )}
            </label>
          ) : null}
          {saveError ? <p className={styles.inlineError} role="alert">{saveError}</p> : null}
          <button
            className={styles.secondary}
            type="button"
            disabled={!titleId || (episodeRequired && !episodeId.trim()) || saving || busy}
            onClick={async () => {
              setSaving(true);
              setSaveError("");
              try {
                await onMatch({ titleId, ...(episodeId.trim() ? { episodeId: episodeId.trim() } : {}) });
              } catch (cause) {
                setSaveError(cause instanceof Error ? cause.message : "This row could not be matched.");
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Saving match…" : row.status === "matched" ? "Update match" : "Save row match"}
          </button>
        </div>
      ) : (
        <p className={styles.fieldHint}>{row.outcome ?? row.status}</p>
      )}
    </li>
  );
}

function ObservationReview({
  observation,
  catalog,
  onConfirm,
}: {
  observation: ConnectionObservation;
  catalog: CatalogHit[];
  onConfirm: (choice: { titleId: string; media: "movie" | "show" | "game"; episodeId?: string; date?: string }) => Promise<void>;
}) {
  const [media, setMedia] = useState<"movie" | "show" | "game">("movie");
  const [titleId, setTitleId] = useState("");
  const [episodeId, setEpisodeId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const titles = catalog.filter((item) => item.media === media);
  const selected = titles.find((item) => item.id === titleId);
  const episodes = selected?.episodes ?? [];

  return (
    <li className={styles.observationReview}>
      <div className={styles.observation}>
        <div>
          <strong>{safeTitle(observation.payload) ?? sourceName(observation.source)}</strong>
          <span>{sourceName(observation.source)} · captured {formatDate(observation.observedAt)}</span>
        </div>
        <span className={styles.reviewTag}>Review needed</span>
      </div>
      <p className={styles.rowNote}>This capture has not changed your journal. Choose a title to confirm it.</p>
      <div className={styles.reviewControls}>
        <label className={styles.field}>
          <span>Media</span>
          <select value={media} onChange={(event) => { setMedia(event.currentTarget.value as typeof media); setTitleId(""); setEpisodeId(""); }}>
            <option value="movie">Film</option>
            <option value="show">Series</option>
            <option value="game">Game</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>Match in Ludex</span>
          <select value={titleId} onChange={(event) => { setTitleId(event.currentTarget.value); setEpisodeId(""); }}>
            <option value="">Choose a catalog title</option>
            {titles.map((item) => <option key={item.id} value={item.id}>{item.title}{item.year ? ` (${item.year})` : ""}</option>)}
          </select>
        </label>
        {media === "show" ? (
          <label className={styles.field}>
            <span>Episode to confirm</span>
            {episodes.length ? (
              <select value={episodeId} onChange={(event) => setEpisodeId(event.currentTarget.value)}>
                <option value="">Choose an episode</option>
                {episodes.map((episode) => <option key={episode.id} value={episode.id}>{episode.title || `Episode ${episode.order}`}</option>)}
              </select>
            ) : (
              <input value={episodeId} onChange={(event) => setEpisodeId(event.currentTarget.value)} placeholder="Enter the Ludex episode ID" />
            )}
          </label>
        ) : null}
        {error ? <p className={styles.inlineError} role="alert">{error}</p> : null}
        <button
          className={styles.secondary}
          type="button"
          disabled={busy || !titleId || (media === "show" && !episodeId)}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await onConfirm({ titleId, media, ...(media === "show" ? { episodeId } : {}) });
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "This capture could not be confirmed.");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Confirming…" : "Confirm capture"}
        </button>
      </div>
    </li>
  );
}

function SteamReview({
  row,
  catalog,
  busy,
  onConfirm,
}: {
  row: SteamPreviewObservation;
  catalog: CatalogHit[];
  busy: boolean;
  onConfirm: (choice: { titleId: string; media: "movie" | "show" | "game"; date?: string }) => Promise<void>;
}) {
  const [titleId, setTitleId] = useState("");
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const games = catalog.filter((item) => item.media === "game");
  return (
    <li className={styles.steamRow}>
      <div className={styles.previewRow}>
        <div><strong>{row.title}</strong><span>Steam App {row.appId} · {row.minutes.toLocaleString()} minutes</span></div>
        <span className={styles.unmatched}>Choose a match</span>
      </div>
      <label className={styles.field}>
        <span>Match to a Ludex game</span>
        <select value={titleId} onChange={(event) => setTitleId(event.currentTarget.value)}>
          <option value="">Choose a catalog game</option>
          {games.map((item) => <option key={item.id} value={item.id}>{item.title}{item.year ? ` (${item.year})` : ""}</option>)}
        </select>
      </label>
      {error ? <p className={styles.inlineError} role="alert">{error}</p> : null}
      <button
        className={styles.secondary}
        type="button"
        disabled={!titleId || busy || confirming}
        onClick={async () => {
          setConfirming(true);
          setError("");
          try {
            await onConfirm({ titleId, media: "game" });
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "This Steam game could not be confirmed.");
          } finally {
            setConfirming(false);
          }
        }}
      >
        {confirming ? "Confirming…" : "Add confirmed game"}
      </button>
    </li>
  );
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function messageFor(error: unknown, fallback: string) {
  if (error instanceof LudexError && (error.status === 401 || error.status === 403))
    return "Your session ended. Sign in again to continue.";
  return error instanceof Error ? error.message : fallback;
}

function isMatched(row: ImportPreview["rows"][number]) {
  return row.status === "matched" && typeof row.matchedTitleId === "string" && row.matchedTitleId.length > 0;
}

function needsReview(row: ImportRow) {
  return row.status === "needs-match" || row.status === "needs-episode";
}

function matchesImportFilter(row: ImportRow, filter: ImportFilter) {
  if (filter === "all") return true;
  if (filter === "needs-review") return needsReview(row);
  if (filter === "matched") return isMatched(row);
  if (filter === "needs-episode") return row.status === "needs-episode";
  if (filter === "accepted") return row.status === "accepted";
  return row.status === "failed" || row.status === "conflict";
}

function dedupeCatalog(items: CatalogHit[]) {
  const byId = new Map<string, CatalogHit>();
  for (const item of items) byId.set(item.id, item);
  return [...byId.values()];
}

function safeTitle(payload: Record<string, unknown> | undefined) {
  return typeof payload?.title === "string" && payload.title.trim() ? payload.title : null;
}

function sourceName(source: string) {
  if (source === "netflix-extension") return "Netflix capture";
  if (source === "letterboxd") return "Letterboxd";
  return source === "csv" ? "CSV" : "Connected source";
}

function mediaName(media: string) {
  if (media === "show") return "Series";
  if (media === "game") return "Game";
  return "Film";
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "recently"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function jobTitle(status: string) {
  if (status === "queued" || status === "running") return "Import in progress";
  if (status === "completed") return "Import complete";
  if (status === "partial") return "Some rows need attention";
  return "Import could not complete";
}
