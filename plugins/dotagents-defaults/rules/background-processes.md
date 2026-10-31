## Background Processes

Dev servers, watchers, and other background processes can keep running for as long as a session needs them. Tear them down when the work is finished.

- Before reporting that a task is done or handing off, stop every process you started, including servers, watchers, builds, and test runners.
- Close pages or browser contexts you opened in a shared browser, including any left behind by a run that was killed or timed out.
- If you find orphaned processes from earlier agent sessions using significant CPU or GPU, stop them and say so.
- Before taking performance timings, check that nothing else is loading the machine.

### Showing Progress

A long run should show that it's still working. When a command may run for more than a minute or two, such as a test suite, a build, a batch of renders, or a benchmark, make it print something at least every 30 seconds or so. Whoever is watching can then tell a slow run from a hung one.

- Before starting it, say roughly how long it should take, so a stall stands out.
- Keep the tool's own progress output, such as a per-file test reporter, rather than silencing it. Don't send a long run's whole output to a file and wait in silence: copy it to the log with `tee`, or print a short line as each step finishes.
- When filtering output, such as with `grep` or by keeping only the last lines, keep the progress lines or a periodic summary visible.
- Scripts and tools that run long should print where they are: the step, the item, how many of how many, and the time elapsed.
