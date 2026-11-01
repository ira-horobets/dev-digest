/* OptionCard — a selectable card used as a radio inside <OptionGroup>.
   Arrow keys move the selection, Space/Enter select. */
"use client";

import React from "react";
import { s } from "./styles";

export interface OptionCardProps {
  title: string;
  description?: string;
  selected: boolean;
  onSelect: () => void;
  /** Small tag next to the title, e.g. "recommended". */
  tag?: string;
  disabled?: boolean;
  /** Why the card is disabled; shown under the description. */
  disabledReason?: string;
}

export function OptionCard({ title, description, selected, onSelect, tag, disabled, disabledReason }: OptionCardProps) {
  return (
    <div
      role="radio"
      aria-checked={selected}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : selected ? 0 : -1}
      data-option-card=""
      onClick={() => !disabled && onSelect()}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onSelect();
        }
      }}
      style={s.card(selected, !!disabled)}
    >
      <div style={s.head}>
        <span style={s.title}>{title}</span>
        {tag && <span style={s.tag}>{tag}</span>}
      </div>
      {description && <div style={s.desc}>{description}</div>}
      {disabled && disabledReason && <div style={s.reason}>{disabledReason}</div>}
    </div>
  );
}

/** Radio group wrapper: ArrowUp/Left and ArrowDown/Right move focus and selection. */
export function OptionGroup({ label, children }: { label: string; children: React.ReactNode }) {
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"];
    if (!keys.includes(e.key)) return;
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-option-card]:not([aria-disabled="true"])'));
    const at = items.findIndex((el) => el === document.activeElement);
    if (items.length === 0) return;
    e.preventDefault();
    const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1;
    const next = items[(at + step + items.length) % items.length];
    next?.focus();
    next?.click();
  };
  return (
    <div role="radiogroup" aria-label={label} onKeyDown={onKeyDown} style={s.group}>
      {children}
    </div>
  );
}
