<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Delivery workflow

- After completing an implementation task, run the relevant checks, commit only the task-related changes with a concise commit message, and push the current branch to its configured upstream unless the user explicitly asks not to.
- Review the working tree before committing and exclude unrelated or pre-existing changes.
- Do not commit or push for read-only reviews, explanations, diagnoses, status checks, or planning tasks.
- Never force-push. If verification fails, no upstream is configured, credentials are unavailable, or the push is rejected, report the problem instead.
