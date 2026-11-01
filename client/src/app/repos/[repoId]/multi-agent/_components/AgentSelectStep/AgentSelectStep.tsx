/* AgentSelectStep — step 2 of the Configure run screen: one card per agent
   (checkbox, icon tile, name, description, estimate) tinted with the agent's
   accent when selected, Select all, and the footer that starts the run. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button, Icon } from "@devdigest/ui";
import type { Agent, AgentEstimate } from "@devdigest/shared";
import { EstimateLabel } from "@/components/estimate-label";
import { agentAccent } from "@/lib/agent-accent";
import type { TotalEstimate } from "@/lib/multi-agent-estimate";
import { StepHeading } from "../StepHeading";
import { s } from "./styles";

export function AgentSelectStep({
  agents,
  estimates,
  selected,
  hasPr,
  total,
  pending,
  onToggle,
  onSelectAll,
  onRun,
}: {
  agents: Agent[];
  estimates: AgentEstimate[] | undefined;
  selected: string[];
  hasPr: boolean;
  total: TotalEstimate;
  pending: boolean;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onRun: () => void;
}) {
  const t = useTranslations("runs");
  const ready = hasPr && agents.length > 0;

  let body: React.ReactNode;
  if (agents.length === 0) {
    body = (
      <div style={s.placeholder}>
        <strong style={s.placeholderTitle}>{t("configure.noAgents.title")}</strong>
        <span>{t("configure.noAgents.body")}</span>
        <Link href="/agents" style={s.link}>
          {t("configure.noAgents.cta")}
        </Link>
      </div>
    );
  } else if (!hasPr) {
    body = (
      <div style={s.placeholder}>
        <span style={s.placeholderIcon}>
          <Icon.GitPullRequest size={18} />
        </span>
        <strong style={s.placeholderTitle}>{t("configure.pickPrFirst")}</strong>
        <span>{t("configure.pickPrFirstBody")}</span>
      </div>
    );
  } else {
    body = (
      <div style={s.list}>
        {agents.map((a) => {
          const checked = selected.includes(a.id);
          const est = estimates?.find((e) => e.agent_id === a.id);
          const accent = agentAccent(a);
          const AgentIcon = Icon[accent.icon];
          return (
            <button
              key={a.id}
              type="button"
              role="checkbox"
              aria-checked={checked}
              aria-label={a.name}
              style={s.card(checked, accent)}
              onClick={() => onToggle(a.id)}
            >
              <span style={s.check(checked, accent)} aria-hidden>
                {checked && <Icon.Check size={12} />}
              </span>
              <span style={s.iconTile(accent)} aria-hidden>
                <AgentIcon size={16} />
              </span>
              <span style={s.text}>
                <span style={s.name}>
                  {a.name}
                  {!a.enabled && <span style={s.disabled}>{t("configure.disabled")}</span>}
                </span>
                <span style={s.summary}>{a.description}</span>
              </span>
              <span style={s.estimate}>
                <EstimateLabel durationMs={est?.duration_ms} costUsd={est?.cost_usd} />
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <section style={s.step} aria-labelledby="multi-step-agents">
      <div style={s.headerRow}>
        <StepHeading id="multi-step-agents" step={2} title={t("configure.step2")} active={hasPr} />
        {ready && (
          <button type="button" style={s.link} onClick={onSelectAll}>
            {t("configure.selectAll")}
          </button>
        )}
      </div>
      <div style={s.body}>
        {body}
        {agents.length > 0 && (
          <div style={s.footer}>
            <Button
              kind="primary"
              icon="Users"
              disabled={!ready || selected.length < 2 || pending}
              loading={pending}
              onClick={onRun}
            >
              {t("configure.runMulti", { count: selected.length })}
            </Button>
            {ready && (
              <span style={s.total}>
                ≈ <EstimateLabel durationMs={total.durationMs} costUsd={total.costUsd} partial={total.partial} /> ·{" "}
                {t("configure.fanOut")}
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
