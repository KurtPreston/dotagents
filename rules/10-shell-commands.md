## Shell Commands

Keep each shell command an agent runs to 20 lines or fewer. In Zed, a taller command pushes the approval button below the fold, where it can't be clicked. For longer logic, write a temporary script file and run it with a one-line command.

Start each script an agent writes, such as one that explores code or applies a change, with a comment saying what it's for and briefly how it works. That way, someone approving or reviewing the script can tell what it does without reading the code.

```python
# Rename the fetchUser helper to loadUser across src/.
# Walks every .ts file, rewrites whole-word matches, and prints each file it changed.
```
