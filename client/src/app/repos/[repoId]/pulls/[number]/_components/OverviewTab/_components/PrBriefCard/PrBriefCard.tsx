/* PrBriefCard — the first card of the Overview tab: the review's verdict tile,
   the model's summary, the score ring and the cost of the one call that wrote it.
   Verdict, score and counts come from the newest review at read time, never
   from the brief model. Model text is rendered as plain text. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Card, CircularScore, ErrorState, Icon, IconBtn, Skeleton } from "@devdigest/ui";
import { useGenerateBrief, usePrBrief } from "@/lib/hooks/brief";
import { useSettings } from "@/lib/hooks/core";
import { featureModelFor } from "@/lib/feature-models";
import { VERDICT_META } from "@/app/repos/[repoId]/pulls/[number]/constants";
import { InfoPopover } from "./_components/InfoPopover";
import {
  BLOCKER_BADGE,
  COUNT_BADGE_COLOR,
  REGENERATE_ICON_SIZE,
  SCORE_SIZE,
  SCORE_STROKE,
  SKELETON_HEIGHT,
  STALE_BADGE,
  VERDICT_ICON_SIZE,
} from "./constants";
import { costLine, isRunning, modelLabel, storedModelLabel } from "./helpers";
import { s } from "./styles";

export function PrBriefCard({
  prId,
  onOpenTrace,
}: {
  prId: string | null;
  onOpenTrace: (runId: string) => void;
}) {
  const t = useTranslations("brief.card");
  const tv = useTranslations("prReview");
  const { data, isLoading, isError, refetch } = usePrBrief(prId);
  const generate = useGenerateBrief(prId);
  const { data: settings } = useSettings();
  const choice = featureModelFor(settings, "risk_brief");
  const currentModel = modelLabel(choice);

  const label = (
    <span style={s.label}>
      <Icon.Sparkles size={14} />
      {t("title")}
    </span>
  );

  if (isLoading) {
    return (
      <Card>
        <div style={s.headRow}>{label}</div>
        <div style={{ marginTop: 12 }}>
          <Skeleton height={SKELETON_HEIGHT} />
        </div>
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <Card>
        <div style={s.headRow}>{label}</div>
        <ErrorState title={t("loadFailed")} onRetry={() => refetch()} />
      </Card>
    );
  }

  const { brief, review, run, stale } = data;
  const running = isRunning(run, generate.isPending);
  const failedText = !running && run?.status === "failed" && run.error ? t("runFailed", { error: run.error }) : null;
  const start = () => {
    if (!running && prId) generate.mutate();
  };

  if (!brief) {
    return (
      <Card>
        <div aria-busy={running}>
          <div style={s.headRow}>{label}</div>
          <div style={s.center}>
            <Button
              kind="primary"
              size="sm"
              icon="Sparkles"
              loading={running}
              disabled={running || !prId}
              title={t("generateHint", { model: currentModel })}
              onClick={start}
            >
              {running ? t("generating") : t("generate")}
            </Button>
          </div>
          {failedText && (
            <p role="alert" style={s.error}>
              {failedText}
            </p>
          )}
        </div>
      </Card>
    );
  }

  const meta = review?.verdict ? (VERDICT_META[review.verdict] ?? VERDICT_META.comment) : null;
  const VIcon = meta ? Icon[meta.icon] : Icon.Clock;
  const storedModel = storedModelLabel(brief);
  const traceRunId = brief.run_id ?? run?.run_id ?? null;
  const line = costLine(brief);

  return (
    <Card>
      <div aria-busy={running}>
        <div style={s.headRow}>
          {label}
          <InfoPopover review={review} model={storedModel} />
          {stale && (
            <span title={t("staleHint")}>
              <Badge color={STALE_BADGE.color} bg={STALE_BADGE.bg} icon="AlertTriangle">
                {t("outOfDate")}
              </Badge>
            </span>
          )}
          <span style={s.spacer} />
          {running ? (
            <Badge icon="RefreshCw">{t("generating")}</Badge>
          ) : (
            <IconBtn icon="RefreshCw" label={t("regenerate", { model: currentModel })} size={REGENERATE_ICON_SIZE} onClick={start} />
          )}
        </div>

        <div style={s.body}>
          {meta ? (
            <span style={s.tile(meta.c, meta.bg)}>
              <VIcon size={VERDICT_ICON_SIZE} />
              {tv(`verdict.${meta.labelKey}`)}
            </span>
          ) : (
            <span style={s.tileNeutral}>
              <VIcon size={VERDICT_ICON_SIZE} />
              {t("notReviewed")}
            </span>
          )}
          <div style={s.main}>
            {review && (
              <div style={s.badges}>
                <Badge color={COUNT_BADGE_COLOR}>{t("findingsBadge", { count: review.findings_count })}</Badge>
                {review.blockers > 0 && (
                  <Badge color={BLOCKER_BADGE.color} bg={BLOCKER_BADGE.bg}>
                    {t("blockers", { count: review.blockers })}
                  </Badge>
                )}
              </div>
            )}
            <p style={s.summary}>{brief.summary}</p>
            {!review && <p style={s.hint}>{t("notReviewedHint")}</p>}
            {stale && <p style={s.hint}>{t("staleHint")}</p>}
          </div>
          {review?.score != null && (
            <div style={s.scoreCol}>
              <CircularScore score={review.score} size={SCORE_SIZE} stroke={SCORE_STROKE} />
              <span style={s.scoreLabel}>{t("score")}</span>
            </div>
          )}
        </div>

        <div style={s.footer}>
          {traceRunId ? (
            <button
              type="button"
              style={s.costBtn}
              aria-label={t("costLine", { cost: line.cost, tokens: line.tokens, model: storedModel })}
              onClick={() => onOpenTrace(traceRunId)}
            >
              {line.text}
            </button>
          ) : (
            <span>{line.text}</span>
          )}
          {brief.files_included < brief.files_total && (
            <span>{t("basedOn", { included: brief.files_included, total: brief.files_total })}</span>
          )}
        </div>
        {failedText && (
          <p role="alert" style={s.error}>
            {failedText}
          </p>
        )}
      </div>
    </Card>
  );
}
