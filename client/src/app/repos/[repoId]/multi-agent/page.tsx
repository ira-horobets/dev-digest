/* /repos/:repoId/multi-agent — Configure run: pick a pull request and the
   agents to run. Suspense is required around useSearchParams (?pr=). */
import React from "react";
import { ConfigureRunView } from "./_components/ConfigureRunView";

export default async function MultiAgentPage({ params }: { params: Promise<{ repoId: string }> }) {
  const { repoId } = await params;
  return (
    <React.Suspense fallback={null}>
      <ConfigureRunView repoId={repoId} />
    </React.Suspense>
  );
}
