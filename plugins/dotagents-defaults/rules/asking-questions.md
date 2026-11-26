## Asking Questions

When asking the user questions with a structured prompt or form tool (such as `ask_user`), never present only closed choices. Editors like Zed render `enum` and `oneOf` fields as radio buttons with no built-in text box, which traps the user if none of the options fit.

- Include an `"Other (specify below)"` option in every single-choice (`enum` or `oneOf`) field so the user does not have to leave an inaccurate option selected.
- Always include an optional open-ended free-text field at the bottom of the form — a plain `type: "string"` property without `enum` or `oneOf` (for example, `notes` or `other`) — so the user can enter a custom answer, combine options, or add caveats.
- Treat anything entered in the free-text field as overriding or qualifying the selected choices.
