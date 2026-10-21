/* RiskAreas — the brief's risk chips inside the Intent card: kind icon, title,
   mono refs, chevron; expanded: explanation and severity. Model text is plain text. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, SEV } from "@devdigest/ui";
import type { Risk } from "@devdigest/shared";
import { parseRef } from "../../helpers";
import { FALLBACK_ICON, KIND_ICON, RISK_SEV } from "./constants";
import { s } from "./styles";

function RiskChip({ risk, onOpenRef }: { risk: Risk; onOpenRef?: (path: string, line: number | null) => void }) {
  const t = useTranslations("brief.risks");
  const [open, setOpen] = React.useState(false);
  const KindIcon = Icon[KIND_ICON[risk.kind] ?? FALLBACK_ICON];
  const Chevron = open ? Icon.ChevronDown : Icon.ChevronRight;
  const sev = SEV[RISK_SEV[risk.severity]];
  return (
    <li style={s.chip}>
      <div style={s.chipHead}>
        <button
          type="button"
          aria-expanded={open}
          aria-label={t(open ? "collapse" : "expand", { title: risk.title })}
          onClick={() => setOpen((o) => !o)}
          style={{ ...s.chipHead, padding: 0, width: "auto", flex: 1 }}
        >
          <KindIcon size={14} />
          <span style={s.chipTitle}>{risk.title}</span>
          <Chevron size={14} />
        </button>
        <span style={s.refs}>
          {risk.file_refs.map((ref) =>
            onOpenRef ? (
              <button
                key={ref}
                type="button"
                className="mono"
                style={s.ref}
                aria-label={t("openRef", { ref })}
                onClick={() => {
                  const target = parseRef(ref);
                  onOpenRef(target.path, target.line);
                }}
              >
                {ref}
              </button>
            ) : (
              <span key={ref} className="mono" style={s.refStatic}>
                {ref}
              </span>
            ),
          )}
        </span>
      </div>
      {open && (
        <div style={s.body}>
          <p style={s.explanation}>{risk.explanation}</p>
          <Badge color={sev.c} bg={sev.bg} icon={sev.icon}>
            {t(`severity.${risk.severity}`)}
          </Badge>
        </div>
      )}
    </li>
  );
}

export function RiskAreas({
  risks,
  onOpenRef,
}: {
  risks: Risk[];
  onOpenRef?: (path: string, line: number | null) => void;
}) {
  const t = useTranslations("brief.risks");
  if (risks.length === 0) return null;
  return (
    <div style={s.wrap}>
      <h4 style={s.title}>{t("title")}</h4>
      <ul style={s.list}>
        {risks.map((r, i) => (
          <RiskChip key={`${r.title}:${i}`} risk={r} onOpenRef={onOpenRef} />
        ))}
      </ul>
    </div>
  );
}
