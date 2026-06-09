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

## Response Format
Every response that makes a code change must end with a **"What was changed & how to implement"** section structured like this:

### What was changed & how to implement

**File(s) updated / added:**
- List each file by name (not full path), with a one-line description of what changed.

**What the change does:**
- Plain-English explanation of the new behaviour. Assume the reader is non-technical.

**How to implement (step by step):**
1. Numbered steps the user must follow to get the change live (e.g. copy code into Apps Script, deploy web app, refresh sheet, etc.).
2. Call out anything that must be done *before* or *after* the change takes effect.

**Nothing else to do** (if no manual steps are needed, say so explicitly).
