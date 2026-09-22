/**
 * Pure dedup helper for the remote-execution poll loop.
 *
 * The server's `getExecutionLogs` re-sends the full transcript-so-far on every
 * poll (the `nextToken` cursor was previously trusted as a continuation token;
 * empirically it isn't, which caused ~3× duplication of every log line).
 * Strategy: ignore the cursor entirely, track how
 * many lines we've already printed, and slice off the un-printed suffix.
 *
 * Contract-agnostic: works whether the server returns identical prefixes,
 * monotonically growing transcripts, or eventually-clean non-overlapping pages.
 *
 * Defensive: if the server ever returns fewer lines than we've already printed
 * (shouldn't happen, but treat as transient glitch), emit nothing and keep
 * `printedCount` stable — never shrink, never re-emit.
 *
 * This module intentionally has zero VS Code imports so it can be unit-tested
 * under vitest's node environment without stubbing the `vscode` API.
 */
export function dedupLogPage(
    returnedLogs: readonly string[],
    printedCount: number
): { fresh: string[]; newPrintedCount: number } {
    if (returnedLogs.length <= printedCount) {
        return { fresh: [], newPrintedCount: printedCount };
    }
    return {
        fresh: returnedLogs.slice(printedCount),
        newPrintedCount: returnedLogs.length,
    };
}
