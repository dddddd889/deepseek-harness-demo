#!/usr/bin/env bun
import { runCli } from "./cli.js";
process.exitCode = await runCli(process.argv.slice(2));
//# sourceMappingURL=cli-entry.js.map