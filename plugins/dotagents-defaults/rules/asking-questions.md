## Asking Questions

When asking the user questions with a structured prompt or form tool (such as `ask_user`), never present only closed choices. Editors like Zed render `enum` and `oneOf` fields as radio buttons with no built-in text box, which traps the user if none of the options fit.

- Include an `"Other (specify below)"` option in every single-choice (`enum` or `oneOf`) field so the user does not have to leave an inaccurate option selected.
- Pair every closed-choice field (`enum`, `oneOf`, or multi-select) with its own optional free-text field immediately after it — a plain `type: "string"` property without `enum` or `oneOf` (for example, `<field>_other` or `<field>_notes`) — rather than a single generic notes box at the bottom of the form.
- Treat anything entered in a question's free-text field as overriding or qualifying that question's selected choice.
