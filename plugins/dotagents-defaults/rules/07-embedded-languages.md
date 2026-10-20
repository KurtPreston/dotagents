## Embedded Languages

When possible, put code in another language in a dedicated file instead of an inline string, such as shaders in `.glsl` or `.wgsl`, queries in `.sql`, and markup in its own template. Dedicated files get syntax highlighting, formatting, and linting, which embedded strings usually lose.

- Load or import the file where it's used. If it needs values filled in, use the language's templating or include mechanism, or a small project helper.
- Short one-line snippets can stay inline when extracting them would hurt readability.
