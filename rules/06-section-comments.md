## Section Comments

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
