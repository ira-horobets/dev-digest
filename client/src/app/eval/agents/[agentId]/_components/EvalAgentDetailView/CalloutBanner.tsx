"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { EvalCallout } from "@devdigest/shared";
import { formatVersion } from "../../../../../../lib/eval-format";
import { s } from "./styles";

/**
 * Structured "what moved" banner rendered from eval.json — never model
 * prose. The causal clause naming flipped cases appears only when the run
 * data actually contains a transition.
 */
export function CalloutBanner({ callout }: { callout: EvalCallout }) {
  const t = useTranslations("eval");
  const metric = t(`callout.metric.${callout.metric}`);
  const magnitude = Math.round(callout.magnitude * 100);
  const down = callout.direction === "down";
  const head = t(down ? "callout.down" : "callout.up", { metric, magnitude });
  const version = t("callout.onVersion", { version: formatVersion(callout.agent_version) });
  const list = callout.case_transitions
    .map((c) => t(c.to ? "callout.nowPassing" : "callout.nowFailing", { name: c.name }))
    .join(", ");
  const tail =
    callout.case_transitions.length > 0
      ? t("callout.transitions", { cases: callout.case_transitions.length, list })
      : t("callout.noTransitions");

  const color = down ? "var(--warn)" : "var(--ok)";
  const bg = down ? "var(--warn-bg)" : "var(--ok-bg, rgba(34,197,94,0.12))";
  const I = down ? Icon.AlertTriangle : Icon.TrendingUp;
  return (
    <div style={s.callout(color, bg)} role="status">
      <I size={16} style={{ color, flexShrink: 0 }} />
      <span>
        <strong style={{ color: "var(--text-primary)" }}>{head}</strong> {version} — {tail}
      </span>
    </div>
  );
}
