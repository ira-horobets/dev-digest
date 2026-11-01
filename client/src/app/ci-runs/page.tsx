/* /ci-runs — agent reviews executed inside CI. Suspense is required around
   useSearchParams (filters live in the URL) on a statically rendered route. */
import React from "react";
import { CiRunsView } from "./_components/CiRunsView";

export default function CiRunsPage() {
  return (
    <React.Suspense fallback={null}>
      <CiRunsView />
    </React.Suspense>
  );
}
