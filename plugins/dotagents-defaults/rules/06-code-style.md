## Code Style

These apply whenever you write or edit code.

### File Size

Keep each source file to one responsibility, small enough to read whole. Aim for files under about 600 lines. A file past 800 almost always holds several things that belong apart.

- Before a change would push a file past that, split the file by responsibility first, in its own commit, then make the change. In a file that's already over, move the part you're changing into its own module rather than adding to it.
- Split by what the code does, not by line count. Move types, constants and helpers out first, then the parts that use them, so imports flow one way without cycles.
- Name each new file for what it holds. When a split makes more than about four files, put them in a directory named for the original.
- Keep the original's public names importable from where they were, re-exporting if needed, so importers don't change.
- A long closure full of shared variables, such as an app's `start` function, can't be split by moving declarations. Gather its state into one explicit context object that the extracted modules take.
- Keep functions short for the same reason. One over about 100 lines usually hides steps that deserve names.
- Make a split a pure move, with no behavior change in the same commit, so a reviewer can check it mechanically.

### Section Comments

When writing or editing code, add brief comments every 3–10 lines. Each comment should be succinct guiding text that describes what the lines below it are doing.

- Place a comment immediately before a logical block of 3–10 lines.
- Keep comments to one short phrase or sentence.
- Describe the upcoming block's purpose, not line-by-line narration.
- Skip comments when a block is shorter than three lines and already self-explanatory.

Prefer:

```typescript
// Validate input and normalize defaults
const email = input.email?.trim().toLowerCase()
if (!email || !isValidEmail(email)) {
  throw new ValidationError('Invalid email')
}
const role = input.role ?? 'member'

// Persist user and emit creation event
const user = await db.users.create({ email, role })
await events.publish('user.created', { userId: user.id })
```

Avoid line-by-line narration:

```typescript
// Trim email
const email = input.email?.trim().toLowerCase()
// Check if valid
if (!email || !isValidEmail(email)) {
```

### Embedded Languages

When possible, put code in another language in a dedicated file instead of an inline string, such as shaders in `.glsl` or `.wgsl`, queries in `.sql`, and markup in its own template. Dedicated files get syntax highlighting, formatting, and linting, which embedded strings usually lose.

- Load or import the file where it's used. If it needs values filled in, use the language's templating or include mechanism, or a small project helper.
- Short one-line snippets can stay inline when extracting them would hurt readability.
