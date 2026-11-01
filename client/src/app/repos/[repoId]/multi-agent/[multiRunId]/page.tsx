/* /repos/:repoId/multi-agent/:multiRunId — results of one multi-agent run.
   Suspense is required around useSearchParams (?view=). */
import React from "react";
import { MultiRunView } from "./_components/MultiRunView";

export default async function MultiRunPage({
  params,
}: {
  params: Promise<{ repoId: string; multiRunId: string }>;
}) {
  const { repoId, multiRunId } = await params;
  return (
    <React.Suspense fallback={null}>
      <MultiRunView repoId={repoId} multiRunId={multiRunId} />
    </React.Suspense>
  );
}
