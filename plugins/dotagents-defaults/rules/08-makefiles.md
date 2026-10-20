## Makefiles

In projects I own that use a Makefile, running `make` with no target should print help listing the targets and what each does, rather than building or running anything. Someone new to the project can type `make` to find out what's available without having to read the Makefile.

- Make `help` the default goal, such as with `.DEFAULT_GOAL := help`.
- Generate the list from the Makefile itself, such as from `## description` notes on each rule line, so it can't drift from the real targets.
- When adding a target, give it a description so it shows up in the help.
- Don't add a Makefile just for this. Projects that run tasks another way, such as `package.json` scripts, keep that convention.
