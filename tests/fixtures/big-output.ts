// Prints a large line, then exits through mcp-call's exit helper, for the flush test.
import { exitAfterFlush } from "../../scripts/mcp/call.ts";

console.log("x".repeat(Number(process.argv[2])));
exitAfterFlush(0);
