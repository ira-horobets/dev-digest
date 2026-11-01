/* AgentColumn — one agent's column: accent strip and icon tile, name,
   duration · cost, score ring (or the status while not done), finding cards
   and a footer with View trace and the findings count. A running column
   streams its run events into the live log and asks for a refetch when the
   stream ends; failed and cancelled columns show the error and keep View
   trace. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { CircularScore, Icon, LiveLogStream, SEV, type Severity } from "@devdigest/ui";
import type { AgentColumn as AgentColumnData } from "@devdigest/shared";
import { eventsToLog } from "@/components/run-trace-drawer";
import { RunCostBadge } from "@/components/run-cost-badge";
import { agentAccent } from "@/lib/agent-accent";
import { formatDuration } from "@/lib/format-duration";
import { useRunEvents } from "@/lib/hooks/reviews";
import { LOG_HEIGHT, SCORE_SIZE } from "./constants";
import { s } from "./styles";

export function AgentColumn({
  column,
  onTrace,
  onStreamEnd,
}: {
  column: AgentColumnData;
  onTrace: (runId: string) => void;
  /** The live stream of this column ended: refetch the run. */
  onStreamEnd: () => void;
}) {
  const t = useTranslations("runs");
  const isRunning = column.status === "running";
  const isDone = column.status === "done";
  // Streams open only for runs still running (an empty list opens nothing).
  const { events, running: streaming } = useRunEvents(isRunning ? [column.run_id] : []);
  const wasStreaming = React.useRef(false);
  React.useEffect(() => {
    if (wasStreaming.current && !streaming) onStreamEnd();
    wasStreaming.current = streaming;
  }, [streaming, onStreamEnd]);

  const accent = agentAccent({ id: column.agent_id ?? column.run_id, name: column.agent_name });
  const AgentIcon = Icon[accent.icon];

  return (
    <section style={s.column(accent.color)} aria-label={column.agent_name} data-testid={`agent-column-${column.run_id}`}>
      <div style={s.head}>
        <span style={s.iconTile(accent)} aria-hidden>
          <AgentIcon size={15} />
        </span>
        <div style={s.headMain}>
          <div style={s.name} title={column.model ?? undefined}>
            {column.agent_name}
          </div>
          <div className="mono tnum" style={s.meta}>
            {formatDuration(column.duration_ms)} · <RunCostBadge variant="compact" costUsd={column.cost_usd} />
          </div>
        </div>
        {isDone && column.score != null ? (
          <CircularScore score={column.score} size={SCORE_SIZE} stroke={3} />
        ) : (
          !isDone && <span style={s.pill(column.status)}>{t(`status.${column.status}`)}</span>
        )}
      </div>

      {isRunning && <LiveLogStream log={eventsToLog(events)} running={streaming} height={LOG_HEIGHT} />}

      {(column.status === "failed" || column.status === "cancelled") && (
        <div role="alert" style={s.error}>
          {column.error ?? t("results.noError")}
        </div>
      )}

      {isDone && (
        <div style={s.list}>
          {column.findings.length === 0 && <span style={s.empty}>{t("column.noFindings")}</span>}
          {column.findings.map((f) => {
            const sev = SEV[f.severity as Severity] ?? SEV.INFO;
            const SevIcon = Icon[sev.icon];
            return (
              <div key={f.id} style={s.finding(sev.c)}>
                <div style={s.findingHead}>
                  <SevIcon size={13} style={s.sevIcon(sev.c)} aria-label={sev.label} />
                  <span style={s.findingTitle}>{f.title}</span>
                </div>
                <span className="mono" style={s.findingLoc} title={`${f.file}:${f.start_line}`}>
                  {f.file}:{f.start_line}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div style={s.footer}>
        <button type="button" className="mono" style={s.traceButton} onClick={() => onTrace(column.run_id)}>
          {t("viewTrace")}
        </button>
        <span>{t("column.findingsCount", { count: column.findings.length })}</span>
      </div>
    </section>
  );
}
