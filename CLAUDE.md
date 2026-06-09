# HGUS Academic System — Project Instructions

## Code Style & Readability
- All generated code must be thoroughly commented. Explain the purpose of each section, key logic decisions, and how to modify parameters.
- Prioritize simple, readable logic flows over clever or complex approaches.
- Anyone new to the project should be able to pick it up, understand it, and extend it without confusion.

## File & Stage Rules
- **Never rewrite existing stage files.** Always copy the prior stage verbatim, then append only new additions.
- Write long scripts in chunks to avoid hitting output token limits.
- Always explicitly state which file(s) need to be updated and where changes go.

## Git Commit Prompts
After every major code change, new feature, or significant update, remind the user to commit with a suggested commit message. Format:

```
📌 Git Commit Reminder
Run this in your terminal:

git add .
git commit -m "<suggested message describing what changed>"
git push
```

Suggested messages should be specific and descriptive (e.g. `"Add carry-forward service to Stage 6"`, not `"Update code"`).
