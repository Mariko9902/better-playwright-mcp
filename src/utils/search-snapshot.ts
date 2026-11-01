/**
 * Search utility for searching snapshot content using ripgrep over stdin.
 */

import { rgPath } from '@vscode/ripgrep';
import { spawnSync } from 'child_process';
import type { SearchOptions, SearchResponse } from '../types/search.js';

const MAX_ALLOWED_LINES = 100;
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

function buildRipgrepArgs(pattern: string, options: { ignoreCase?: boolean; limit?: number; countOnly?: boolean }) {
  const args = ['--color=never', '--no-heading', '--text'];
  if (options.ignoreCase)
    args.push('-i');
  if (options.countOnly)
    args.push('-c');
  if (options.limit !== undefined)
    args.push('-m', String(options.limit));
  args.push('-e', pattern, '-');
  return args;
}

function runRipgrep(snapshot: string, args: string[]) {
  const result = spawnSync(rgPath, args, {
    input: snapshot,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER_BYTES,
  });
  const isBrokenPipe = (result.error as any)?.code === 'EPIPE';

  if (result.status === 1)
    return { matched: false, stdout: '' };

  if (result.error && !isBrokenPipe)
    throw result.error;

  if (result.status !== 0)
    throw new Error((result.stderr || result.stdout || `ripgrep exited with code ${result.status}`).trim());

  return {
    matched: true,
    stdout: result.stdout ?? '',
  };
}

/**
 * Search snapshot content using ripgrep with regular expression support.
 * The fast path reads the snapshot from stdin and only materializes the first N lines.
 * Exact total counts are computed only when truncation actually happens.
 */
export function searchSnapshot(snapshot: string, options: SearchOptions): SearchResponse {
  const effectiveLimit = Math.min(options.lineLimit || MAX_ALLOWED_LINES, MAX_ALLOWED_LINES);
  const preview = runRipgrep(snapshot, buildRipgrepArgs(options.pattern, {
    ignoreCase: options.ignoreCase,
    limit: effectiveLimit + 1,
  }));

  if (!preview.matched) {
    return {
      result: '',
      matchCount: 0,
      truncated: false,
    };
  }

  const lines = String(preview.stdout)
    .split('\n')
    .filter(line => line.length > 0);

  if (lines.length <= effectiveLimit) {
    return {
      result: lines.join('\n'),
      matchCount: lines.length,
      truncated: false,
    };
  }

  const countResult = runRipgrep(snapshot, buildRipgrepArgs(options.pattern, {
    ignoreCase: options.ignoreCase,
    countOnly: true,
  }));
  const matchCount = Number.parseInt(String(countResult.stdout).trim(), 10);
  const totalMatches = Number.isFinite(matchCount) ? matchCount : lines.length;

  const truncatedLines = lines.slice(0, effectiveLimit);
  truncatedLines.push(`<...${Math.max(totalMatches - effectiveLimit, 0)} more results...>`);
  return {
    result: truncatedLines.join('\n'),
    matchCount: totalMatches,
    truncated: true,
  };
}
