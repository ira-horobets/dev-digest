/* FileViewer — path header, editable / read-only tag, and the file body:
   a labelled <textarea> when editable, a <pre> otherwise. */
"use client";

import React from "react";
import { s } from "./styles";

export interface FileViewerProps {
  path: string;
  contents: string;
  editable?: boolean;
  onChange?: (next: string) => void;
  editableLabel: string;
  readOnlyLabel: string;
  /** Warning shown under the header (e.g. YAML error, key-like text). */
  warning?: React.ReactNode;
  /** Right side of the header, e.g. a "will overwrite" tag. */
  extra?: React.ReactNode;
  /** Max height of the scrolling body. */
  maxHeight?: number;
}

export function FileViewer({
  path,
  contents,
  editable = false,
  onChange,
  editableLabel,
  readOnlyLabel,
  warning,
  extra,
  maxHeight = 220,
}: FileViewerProps) {
  return (
    <section aria-label={path} style={s.wrap}>
      <header style={s.header}>
        <code style={s.path}>{path}</code>
        <span style={s.tag(editable)}>{editable ? editableLabel : readOnlyLabel}</span>
        {extra}
      </header>
      {warning && (
        <div role="alert" style={s.warning}>
          {warning}
        </div>
      )}
      {editable ? (
        <textarea
          aria-label={path}
          value={contents}
          spellCheck={false}
          onChange={(e) => onChange?.(e.target.value)}
          style={{ ...s.body, maxHeight, minHeight: 140 }}
        />
      ) : (
        <pre tabIndex={0} aria-label={`${path} contents`} style={{ ...s.body, maxHeight }}>
          {contents === "" ? " " : contents}
        </pre>
      )}
    </section>
  );
}
