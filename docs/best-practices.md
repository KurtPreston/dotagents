# Best practices

Read this before changing dotagents. Each entry says what to do and why.

## One language, one toolchain

- Write code in TypeScript, run directly by Node through type stripping, with no build step. Bash is only for the `install.sh` wrapper, which checks for Node before anything else runs, and for small plugin scripts. One language means one set of tools, tests, and conventions to learn.
- Use only TypeScript syntax that Node can strip: no `enum`s, namespaces, or parameter properties. Import local files with their `.ts` extension. `tsconfig.json` enforces both with `erasableSyntaxOnly` and `allowImportingTsExtensions`.
- Node doesn't check types when it runs a file, so `npm run typecheck` is part of validation.
- `package-lock.json` must resolve packages from `https://registry.npmjs.org/`. This repository is public and its action runs on public runners, but npm here may use an internal mirror, which writes the mirror's URLs into the lockfile. If it does, rewrite them to `registry.npmjs.org` before committing. npm's default `replace-registry-host` setting maps those URLs back to whichever registry each machine uses.

## Simplicity over per-part tuning

- The whole repository shares one `package.json`, one lockfile, one Node version requirement, and one set of TypeScript, lint, and format settings. Don't give one part its own versions or config, even if that means churn when something is upgraded for one part. Tools that grow into their own products, as `autoreview` did, belong in their own repositories.
- This is a young project with one user, so prefer one clean implementation over keeping old behavior, formats, or edge cases working. Edge cases that are unlikely in practice don't justify extra code or a second path. Formatting of files the installer edits doesn't matter.

## Plugins

- An MCP server declaration names the program to run, such as `npx`, not where it's installed. The installer resolves it on `PATH`, so switching version managers needs only a reinstall.
- Keep static context small. Only MCP servers used in most sessions should be `"load": "static"`; make the rest on-demand, with a skill that says when to use them and calls them through `mcp-call`. Rules should say when to reach for a tool, not restate its tool list.
