/* Stepper — ordered step list: done (check mark), current, upcoming. */
import React from "react";
import { Icon } from "@devdigest/ui";
import { s } from "./styles";

export interface StepperProps {
  /** Accessible name of the list. */
  label: string;
  steps: string[];
  /** Zero-based index of the current step. */
  current: number;
}

export function Stepper({ label, steps, current }: StepperProps) {
  return (
    <ol aria-label={label} style={s.list}>
      {steps.map((name, i) => {
        const state = i < current ? "done" : i === current ? "current" : "upcoming";
        return (
          <li key={name} aria-current={state === "current" ? "step" : undefined} style={s.item}>
            <span style={s.dot(state)} aria-hidden="true">
              {state === "done" ? <Icon.Check size={12} /> : i + 1}
            </span>
            <span style={s.name(state)}>{name}</span>
            {i < steps.length - 1 && <span style={s.line(state === "done")} aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}
