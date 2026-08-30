# Technical README and Publish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended) or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Document the current Gauntlet product clearly for developers and non-technical users, then verify and publish all workspace changes.

**Architecture:** Add a repository-level README that mirrors the implemented Next.js web app, CLI, evaluation engine, benchmark harness, and operational boundaries. Keep the README evidence-based: distinguish the measured planted-fixture benchmark from unsupported claims about arbitrary production agents.

**Tech Stack:** Next.js 15, React 19, TypeScript strict, Tailwind CSS 4, Vitest, pnpm, Anthropic/OpenAI-compatible providers, SQLite via better-sqlite3.

**Spec:** User request plus `.context/attachments/7pr3p9/session-transcript-37298d9c-a77f-444c-9276-d3924a82f7f5.md`.

## Global Constraints

- Write in Spanish rioplatense, using direct and technically precise language.
- Document only behavior present in the repository; label estimates, benchmark scope, and known limitations.
- Do not expose API keys, stored credentials, local database files, or production URLs.
- Do not rename the current branch, merge into `main`, or force-push.
- Verify tests, typecheck, build, repository diff, and push result before claiming completion.

---

### Task 1: Repository README

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: `package.json`, `src/cli/*`, `src/engine/*`, `src/app/*`, `bench/*`, and `bench/results/latest.md`.
- Produces: A self-contained onboarding, reference, architecture, benchmark, security, and limitations guide.

- [ ] **Step 1: Write the README sections**

Include: product positioning, quick start, web flow, CLI flow, config example, engine pipeline, benchmark table with date and scope, fixture matrix, security notes, commands, and known limitations.

- [ ] **Step 2: Cross-check every command and claim against source**

Run `rg` over scripts, CLI usage, environment variables, endpoints, and benchmark output. Remove any command or assertion not implemented.

- [ ] **Step 3: Review the rendered Markdown structure**

Check headings, fenced code blocks, tables, links, Mermaid syntax, and the absence of secrets or ignored local artifacts.

### Task 2: Verification and publish

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-08-30-technical-readme-and-publish.md`

**Interfaces:**
- Consumes: The documented commands and repository state.
- Produces: A commit on the current branch and a corresponding remote branch on `origin`.

- [ ] **Step 1: Run the free verification suite**

Run `pnpm test`, `pnpm typecheck`, and `pnpm build`.

- [ ] **Step 2: Inspect the final diff and status**

Run `git diff --check`, `git diff --stat`, `git status --short`, and `git log --oneline origin/main..HEAD`.

- [ ] **Step 3: Commit the README and plan**

Run `git add README.md docs/superpowers/plans/2026-08-30-technical-readme-and-publish.md && git commit -m "docs: add technical product README"`.

- [ ] **Step 4: Push the current branch**

Run `git push -u origin office-hours-command-meaning` and verify the remote tracking state with `git status --short --branch`.
