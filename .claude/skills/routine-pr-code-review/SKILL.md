---
name: routine-pr-code-review
description: Unattended code review for Claude Code routines. Reviews the pull request from the routine's GitHub context (or a PR number argument) with /code-review plus its own checks, checks the tests and the manual test plan, and posts the review as a PR comment without asking for confirmation.
---

Review a pull request on this repository and post the review as a comment on it.

This skill runs unattended inside a Claude Code routine, so nobody can answer questions or approve the post. Running this skill **is** the approval to post one review comment on the PR, and then to collapse this skill's own earlier reviews on that PR (step 5). Take no other GitHub action: don't approve, request changes, label, push, comment on issues, or edit any other comment.

**Reaching GitHub:** follow `.claude/skills/routine-pr-review/GITHUB.md`. In short: only `gh api` REST calls work in a routine (no `gh pr`, `gh issue`, or GraphQL), and every call names `mandreljs/mandrel.js`. The commands below follow it.

## 1. Find the PR

Use the PR number passed as an argument if there is one. Otherwise take it from the GitHub event context the routine provided. If neither gives you a PR number, stop without posting anything. Never guess a PR.

Read the PR with `gh api repos/mandreljs/mandrel.js/pulls/<n>`. Its **head commit** is `head.sha`, and its base branch is `base.ref`.

Find this skill's earlier reviews in the PR's comments (`gh api repos/mandreljs/mandrel.js/issues/<n>/comments --paginate`). They contain `<!-- routine-pr-code-review`. Count only comments written by the account the routine posts as (`gh api user --jq .login`).

If one of them already has the marker `<!-- routine-pr-code-review sha=<head commit>`, stop without posting. That happens when both routines run with no new commits in between, and a second review of the same code would only repeat the first.

## 2. Gather context

Read all of this before judging the code:

- The PR: its description, its comments, its inline code comments (`gh api repos/mandreljs/mandrel.js/pulls/<n>/comments --paginate`) and its review summaries (`gh api repos/mandreljs/mandrel.js/pulls/<n>/reviews --paginate`).
- Linked issues: issues the PR body refers to (`Fixes`/`Closes`/`Resolves` and plain references), plus issues linked in its timeline (see `GITHUB.md`). Read each issue and its comments. They say what the PR is supposed to do.
- The project's own references, as far as the change touches them: `CLAUDE.md` (the rules), `docs/DECISIONS.md` (what was decided and why), `docs/PLAN.md` (what's planned), and `docs/MOVEMENT.md`, `docs/WEAPONS.md`, and `docs/ENEMIES.md`, which movement, weapon, and enemy code must follow.

Use the conversation to learn what's already been discussed or decided. Don't re-raise something the thread or `docs/DECISIONS.md` settled. If you still think a settled point is a real problem, say so once, acknowledge the earlier decision, and explain what's new.

**Follow-up reviews.** If step 1 found earlier reviews from this skill, this run is a follow-up, for example the PR was reviewed when it opened and is now marked ready for review. Read the newest one and the commit it recorded. Review the whole PR again, but open with a "Since the last review" list saying which earlier findings are fixed, still open, or no longer apply, and point out what changed since that commit (`git diff <old sha>..<head sha>` in the PR folder, fetching the old commit first if needed).

## 3. Review

Put the PR's code in a separate folder so you can read whole files, not just diff hunks:

```bash
git fetch origin pull/<n>/head
git worktree add --detach ../mandreljs-pr-<n> FETCH_HEAD   # reuse it if it already exists
```

Read files and run commands for the PR there. **Don't switch this checkout to the PR branch** (no `gh pr checkout`). The routine's skills are read from this checkout, which stays on `develop`, so the next skill gets the right instructions and a PR can't change the instructions it's reviewed under.

**Do your own full review first, without looking at the manual test plan.** The review has to stand on its own; the plan check below adds to it, never replaces it.

Run the `code-review` skill on the PR (`/code-review <n>`) for the bug hunt. Don't use its `--comment` or `--fix` options: this skill posts one comment of its own and never changes the code. If it can't load the PR by number (it may use GitHub commands a routine blocks), give it a local branch instead: `git fetch origin pull/<n>/head:pr-<n>` (this creates a branch without switching to it), then `/code-review pr-<n>`.

Then add what that pass doesn't cover:

- **Does the PR deliver what the linked issues ask for?** Call out anything missing, or anything that behaves differently from what was asked.
- **The rules in `CLAUDE.md`.** The ones a diff most often breaks:
  - _Simulation rules_ (anything in `packages/sim`): the tick rate comes only from its one constant, and durations in data are seconds converted to ticks; no `Math.random` (randomness comes from the seeded RNG in sim state); no `Math.sin`, `cos`, `atan2`, `hypot` and the like (trigonometry comes from `packages/sim/src/math/trig.ts`); no wall clock, input devices, renderer, DOM, Node APIs, Three.js, or other packages; state stays plain, serializable data with stable entity IDs; the sim emits events and never calls presentation code; enemy decisions run on the 10 Hz think cadence.
  - _Data-driven content_: weapon, enemy, and movement numbers belong in a game's `data/`, not in code. A new behavior is a generic engine action, named for what it does and never for one monster, with example content and tests that use it. Content never contains code.
  - _Imports_: apps import packages by module path; shared code is in a package, never imported from another app; engine code never imports from `tools/`.
  - _Docs it must follow_: player movement and collision follow `docs/MOVEMENT.md`, weapons `docs/WEAPONS.md`, enemies `docs/ENEMIES.md`. A change that departs from them needs the doc updated too, and usually a `docs/DECISIONS.md` entry.
  - _Naming_: the engine is Mandrel.js, or `mandreljs` where a dot isn't allowed, never just "Mandrel".
  - _Docs kept in step_: a changed command, option, or file name updates the README, `tools/package-readme.md`, and the usage text in `tools/src/mandreljs.ts`. A changed engine-file path updates both `tools/src/engine-files.ts` and `tools/src/engine-files.package.ts`.
  - _Licensing_: new dependencies are GPLv3-compatible; code adapted from GPLv2-or-later or GPLv3 projects credits its source in a comment; nothing is copied from GPLv2-only projects; a new kind of content is listed in `LICENSE-EXCEPTION.md`; changes to the client's build keep the shipped notices working.
- **Tests.** We want tests that check real behavior and can fail. Check new and changed tests against the testing rules in `CLAUDE.md`: every gameplay change ships with unit tests, plus a scenario in `scenarios/` when the behavior is observable. Flag tests that would pass no matter what the code does (assertions on mocks, missing `await`, conditions that are always true, a `try` that swallows the failure), and point out important behavior with no test. **Flag any changed test expectation, scenario tolerance, or golden demo** that the PR doesn't explain: those may only change for an intentional behavior or content change, and a rebaselined demo must be called out in its commit message (`git log` in the PR folder). Check that test files mirror `src/` and import packages by module path.
- **Run the checks when the environment allows it**, in the PR folder. `npm ci` first, then `npm run typecheck`, `npm run validate`, and the changed and added test files with `npx vitest run <file>`. The compile tests need ericw-tools: try `npm run setup` once, and if it can't download them, say the compile tests were skipped. If time allows, run all of `npm test`. For a test that claims to guard against a bug, check that it really fails without the fix: temporarily restore the base version of the non-test files (`git checkout origin/<base> -- <files>`), run the test, confirm it fails, then put the PR version back (`git checkout HEAD -- <files>`). Say in the review what you ran and what happened. If you couldn't run something, say so; never imply checks were run when they weren't.

**Last, check the code against the manual test plan**, as an extra pass on top of everything above. The entry skill runs the test plan first and tells you where its file is (`plans/mandrel.js/<n>/<short commit>.json` in the `pr-test-plans` checkout). If you were run on your own, read it from GitHub: `gh api repos/mandreljs/pr-test-plans/contents/plans/mandrel.js/<n>/<short commit>.json -H "Accept: application/vnd.github.raw"` (a 404 means there's no plan).

- For each test, trace through the PR's code whether a tester following its steps would really see what it expects. A test the code won't pass is a finding: name the test ("T4 expects …") and show where the code goes another way.
- Notice what the plan's player's-eye view brings up that your own review missed, like a map that doesn't load, a browser that behaves differently, a fresh install without ericw-tools, or a `mandreljs` command run from a game's own repo instead of this one.
- Merge these into your findings; don't list them separately.
- If there's no plan for this commit (none was needed, or writing it failed), skip this pass and say so in one line under Summary.

Before writing a finding up, confirm it by re-reading the code it depends on. Drop findings you can't support. If something might be a problem but you can't tell, ask it as a question instead of stating it as a bug.

## 4. Write the review

Write so it's understood on the first read by someone without the code in front of them: plain language, the short answer first, and why each problem matters. Write the review to a file in this shape:

```markdown
> [!NOTE]
> This review was generated by a Claude Code routine set up by Ryan Cook.

<!-- routine-pr-code-review sha=<full head sha> -->

**Reviewed commit:** `<short sha>`

## Summary

<2–4 sentences: what the PR does, whether it delivers what the linked issue asks for, and the overall verdict: ready to merge, needs changes, or needs discussion.>

## Since the last review

<Follow-up reviews only: each earlier finding marked fixed, still open, or no longer applies.>

## Findings

### 🔴 Critical

### 🟠 High

### 🟡 Medium

### 🔵 Low

## Tests

<What the tests cover, which ones are weak or can't fail, what's missing, and what you ran and what happened.>
```

- Severity guide. **Critical**: breaks determinism (demos stop replaying), a security hole, a crash, a map or game that no longer loads or compiles, or the main way to play broken for most players. **High**: a real bug players or game makers will hit, a broken `CLAUDE.md` rule, or the PR doesn't do what the issue asks. **Medium**: edge-case bugs, missing error handling, weak tests for important behavior. **Low**: small cleanups and nits. Leave out empty severity headings. If there are no findings, say so plainly.
- Number findings in one sequence across all severities, written as **No. 1**, **No. 2**, and so on, so people can refer to them in replies.
- Each finding has:
  - A short title.
  - What's wrong and why it matters, in plain words.
  - **Steps to reproduce**, numbered, written so a human developer can see the problem in the game, a command, or a test. Include these only when the problem can actually be reproduced; don't invent steps for a theoretical issue.
  - **Suggested fix**: concrete, with a short code snippet when that's clearer than prose.

## 5. Post

Post exactly once: `gh api repos/mandreljs/mandrel.js/issues/<n>/comments -F body=@review.md`. If posting fails, end the run with the full review text in your output so it isn't lost, and skip the rest of this step.

**Then collapse the earlier reviews**, so a PR with several reviews stays short to scroll. A routine can't hide comments (that needs GitHub's GraphQL API, which is blocked), so instead edit each earlier review to fold its content into a collapsible block. Do this only after the new review has posted.

1. **Pick the reviews to collapse:** the earlier reviews from step 1 (same account only), minus the one you just posted, minus any already containing `<!-- routine-pr-code-review collapsed -->`.
2. **Build each new body** in a file, keeping the original text exactly as it was:
   - **The note box stays outside, at the top.** That's the run of lines at the very start that begin with `>` (the `> [!NOTE]` box), plus the blank line after it. GitHub won't render a note box inside a collapsed block; it shows a literal "[!NOTE]" instead.
   - Then this, with the rest of the original body in the middle, unchanged:

     ```markdown
     <!-- routine-pr-code-review collapsed -->

     <details>
     <summary>Earlier review for commit <code>abc1234</code>, replaced by a newer review below</summary>

     <rest of the original body, unchanged, including its hidden marker>

     </details>
     ```

   - Take the commit from the review's `sha=` marker.
   - Keep the blank line after `</summary>` and before `</details>`, or GitHub won't render the markdown inside. Use HTML in the summary line (`<code>`, not backticks); GitHub doesn't render markdown there.

3. **Skip a review** if the new body would be over 65,536 characters (GitHub's comment limit).
4. **Update it:** `gh api -X PATCH repos/mandreljs/mandrel.js/issues/comments/<id> -F body=@collapsed.md`.

If collapsing fails, leave that review as it is and mention it in your output. The new review is what matters.

**Gotchas**

- GitHub turns `#` followed by a number into a link to that issue or PR. To refer to a list item or finding, write "No. 1", never "#1".
- A GitHub comment can be at most 65,536 characters. If the review would be longer, shorten the Low findings first.
