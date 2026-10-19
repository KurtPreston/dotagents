## Backwards Compatibility

Don't assume full backwards compatibility on a young project. Preserving existing behavior, formats, and APIs is the right default for an established project, but on a new one it often blocks a cleaner design.

- If a project looks young (recent history, few users, prototypes or demos) and its docs don't say how much compatibility matters, ask before designing a significant change. Ask whether to preserve existing behavior, or whether broader refactors and visible changes are welcome.
- When compatibility isn't required, prefer one clean implementation over fallbacks, shims, or parallel old and new paths. Still point out what changes visibly, and why.
