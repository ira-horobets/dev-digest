import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { toToolError, UserError } from '../errors.js';
import type { ToolDeps } from './types.js';

export const NAME = 'devdigest_get_blast_radius';
export const TITLE = 'get_blast_radius';
export const DESCRIPTION =
  'Planned: the impact map of a pull request (changed symbols and the downstream files that depend on them). ' +
  'Not implemented yet: it always returns an error describing the expected shape. ' +
  'Use devdigest_get_findings or the DevDigest UI meanwhile.';

export function register(server: McpServer, _deps: ToolDeps): void {
  server.registerTool(
    NAME,
    {
      title: TITLE,
      description: DESCRIPTION,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () =>
      toToolError(
        new UserError(
          'devdigest_get_blast_radius is not implemented yet (homework, L04). ' +
            'Expected result shape: { changed_symbols: [...], downstream: [...], summary: string } ' +
            '(BlastRadius in @devdigest/shared contracts/brief.ts).',
        ),
      ),
  );
}
