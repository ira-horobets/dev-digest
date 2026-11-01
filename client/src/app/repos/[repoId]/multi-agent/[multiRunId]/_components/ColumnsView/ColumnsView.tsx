/* ColumnsView — agent columns side by side, sharing the width equally; when
   they no longer fit at their minimum width the row scrolls sideways, and
   every column's finding list scrolls on its own. */
"use client";

import React from "react";
import { s } from "./styles";

export function ColumnsView({ children }: { children: React.ReactNode }) {
  return <div style={s.row(React.Children.count(children))}>{children}</div>;
}
