import { useEffect, useMemo, useRef, useState } from "react";
import {
  getAnalyticsDebugBuffer,
  subscribeAnalyticsDebug,
  clearAnalyticsDebugBuffer,
  type AnalyticsDebugEvent,
} from "@/lib/analytics";

const STORAGE_KEY = "uf:analytics-debug";

function isEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("debug") === "analytics") {
      localStorage.setItem(STORAGE_KEY, "1");
      return true;
    }
    if (params.get("debug") === "off") {
      localStorage.removeItem(STORAGE_KEY);
      return false;
    }
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function formatTs(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour12: false }) +
    "." + String(d.getMilliseconds()).padStart(3, "0");
}

function stripInternal(params: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (k === "send_to") continue;
    out[k] = v;
  }
  return out;
}

export default function AnalyticsDebugPanel() {
  const [enabled, setEnabled] = useState<boolean>(() => isEnabled());
  const [open, setOpen] = useState<boolean>(true);
  const [events, setEvents] = useState<AnalyticsDebugEvent[]>(() =>
    enabled ? getAnalyticsDebugBuffer() : []
  );
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);

  useEffect(() => {
    if (!enabled) return;
    const unsub = subscribeAnalyticsDebug((e) => {
      setEvents((prev) => {
        const next = prev.concat(e);
        return next.length > 200 ? next.slice(next.length - 200) : next;
      });
    });
    return unsub;
  }, [enabled]);

  useEffect(() => {
    if (autoScroll.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  const filtered = useMemo(() => {
    if (!filter.trim()) return events;
    const f = filter.trim().toLowerCase();
    return events.filter(
      (e) =>
        e.name.toLowerCase().includes(f) ||
        JSON.stringify(e.params).toLowerCase().includes(f)
    );
  }, [events, filter]);

  if (!enabled) return null;

  const toggleOpen = () => setOpen((v) => !v);
  const disable = () => {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    setEnabled(false);
  };

  return (
    <div
      style={{
        position: "fixed",
        right: 8,
        bottom: 8,
        zIndex: 2147483647,
        width: open ? "min(420px, calc(100vw - 16px))" : "auto",
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 11,
        color: "#e5e7eb",
        pointerEvents: "auto",
      }}
      aria-live="polite"
    >
      {!open ? (
        <button
          onClick={toggleOpen}
          style={{
            background: "rgba(15,15,20,0.9)",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: 999,
            padding: "6px 10px",
            color: "#fff",
            backdropFilter: "blur(8px)",
          }}
        >
          GA4 · {events.length}
        </button>
      ) : (
        <div
          style={{
            background: "rgba(10,10,14,0.92)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 12,
            backdropFilter: "blur(10px)",
            boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 10px",
              borderBottom: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <strong style={{ color: "#FF2D55" }}>GA4 Debug</strong>
            <span style={{ opacity: 0.6 }}>{events.length} events</span>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="filter…"
              style={{
                marginLeft: "auto",
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 6,
                padding: "3px 6px",
                color: "#fff",
                width: 100,
                outline: "none",
              }}
            />
            <button
              onClick={() => {
                clearAnalyticsDebugBuffer();
                setEvents([]);
              }}
              style={btn}
              title="Clear"
            >
              Clear
            </button>
            <button onClick={toggleOpen} style={btn} title="Minimize">
              _
            </button>
            <button onClick={disable} style={btn} title="Turn off (add ?debug=analytics to re-enable)">
              ×
            </button>
          </div>

          <div
            ref={scrollRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              autoScroll.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 20;
            }}
            style={{
              maxHeight: 320,
              overflow: "auto",
              padding: 6,
            }}
          >
            {filtered.length === 0 ? (
              <div style={{ opacity: 0.5, padding: 8 }}>
                No events yet. Navigate or interact with the app.
              </div>
            ) : (
              filtered.map((e) => {
                const isOpen = !!expanded[e.id];
                const params = stripInternal(e.params);
                return (
                  <div
                    key={e.id}
                    style={{
                      borderBottom: "1px dashed rgba(255,255,255,0.07)",
                      padding: "4px 4px",
                    }}
                  >
                    <button
                      onClick={() =>
                        setExpanded((prev) => ({ ...prev, [e.id]: !prev[e.id] }))
                      }
                      style={{
                        display: "flex",
                        gap: 8,
                        width: "100%",
                        textAlign: "left",
                        background: "transparent",
                        border: "none",
                        color: "inherit",
                        cursor: "pointer",
                        padding: 2,
                      }}
                    >
                      <span style={{ color: "#9ca3af" }}>
                        {formatTs(e.ts)}
                      </span>
                      <span style={{ color: "#22d3ee", fontWeight: 600 }}>
                        {e.name}
                      </span>
                      <span style={{ marginLeft: "auto", opacity: 0.6 }}>
                        {Object.keys(params).length} props {isOpen ? "▾" : "▸"}
                      </span>
                    </button>
                    {isOpen && (
                      <pre
                        style={{
                          margin: "4px 0 2px 0",
                          padding: 6,
                          background: "rgba(255,255,255,0.04)",
                          borderRadius: 6,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          color: "#e5e7eb",
                        }}
                      >
                        {JSON.stringify(params, null, 2)}
                      </pre>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const btn: React.CSSProperties = {
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.1)",
  color: "#fff",
  borderRadius: 6,
  padding: "3px 7px",
  cursor: "pointer",
};
