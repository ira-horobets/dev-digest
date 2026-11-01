/* StepHeading — numbered step title of the Configure run screen: a round badge
   with the step number, then the title. Inactive steps are muted. */
import React from "react";
import { s } from "./styles";

export function StepHeading({
  id,
  step,
  title,
  active = true,
}: {
  id: string;
  step: number;
  title: string;
  active?: boolean;
}) {
  return (
    <div style={s.row}>
      <span style={s.badge(active)} aria-hidden>
        {step}
      </span>
      <h2 id={id} style={s.title(active)}>
        {title}
      </h2>
    </div>
  );
}
