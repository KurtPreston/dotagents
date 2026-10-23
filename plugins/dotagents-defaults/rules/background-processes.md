## Background Processes

Dev servers, watchers, and other background processes can keep running for as long as a session needs them. Tear them down when the work is finished.

- Before reporting that a task is done or handing off, stop every process you started, including servers, watchers, builds, and test runners.
- Close pages or browser contexts you opened in a shared browser, including any left behind by a run that was killed or timed out.
- If you find orphaned processes from earlier agent sessions using significant CPU or GPU, stop them and say so.
- Before taking performance timings, check that nothing else is loading the machine.
