---
name: routine-pr-human-review-plan
description: Unattended skill for Claude Code routines. Writes a step-by-step manual test plan for a pull request, publishes it to the Mandrel.js Test Plans site (mandreljs.github.io/pr-test-plans) by committing the plan JSON to mandreljs/pr-test-plans, and keeps one test plan comment on the PR up to date with the link. Takes the PR from the routine's GitHub context or a PR number argument.
---

Write a manual test plan for a pull request on this repository, publish it on the Mandrel.js Test Plans site, and link to it from the PR's test plan comment.

The plan is for **developers** who know git, GitHub, a terminal, and npm, but may not know this part of the codebase or what the PR changes. With no preview builds, testers run the PR themselves, so you can rely on those basics and keep setup short. The tests themselves still look at the change the way players and game makers will: what happens in the game, in TrenchBroom, or when running the `mandreljs` command, not how the code is built. A tester should be able to go from the PR comment to finishing every test without asking anyone for help. The site lets them mark each test Pass / Fail / Blocked / Skip, add notes, pick up where they left off after a reload (results save in their browser), and copy their results as markdown to paste back into the PR.

**How publishing works.** The site (https://mandreljs.github.io/pr-test-plans/) is a static page in the public repo `mandreljs/pr-test-plans`. Each plan is one JSON file at `plans/mandrel.js/<pr number>/<short commit>.json`, and every push to that repo's `main` redeploys the site within a minute or two. A PR gets one plan per commit it's tested at. Older plans are never overwritten, and the page links between them. That repo's `README.md` is the reference for the plan format, and its `tools/plan.mjs` checks a plan.

This skill runs unattended inside a Claude Code routine, so nobody can answer questions or approve anything. Running this skill **is** the approval to do exactly two things:

- commit **one new plan file** to `mandreljs/pr-test-plans` `main`
- post this skill's **one comment** on the PR, or edit it if it's already there (each PR has one test plan comment that's kept up to date)

Take no other GitHub action. Don't approve, request changes, label, edit or push to the PR, comment on issues, or change any other file in `pr-test-plans` (its page and tools change only through normal PRs).

**Reaching GitHub:** follow `.claude/skills/routine-pr-review/GITHUB.md`. In short: only `gh api` REST calls work in a routine (no `gh pr`, `gh issue`, `gh repo`, or GraphQL), and every call names `mandreljs/mandrel.js`. The commands below follow it.

## 1. Find the PR

Use the PR number passed as an argument if there is one. Otherwise take it from the GitHub event context the routine provided. If neither gives you a PR number, stop without posting anything. Never guess a PR.

Read the PR with `gh api repos/mandreljs/mandrel.js/pulls/<n>`. The **head commit** is `head.sha`; its first 7 characters are the **short commit**. The branch is `head.ref`. If `head.repo.full_name` isn't `mandreljs/mandrel.js`, the PR comes from a fork.

## 2. Get the test plans repo, and stop early if there's nothing to do

Use an existing checkout of `mandreljs/pr-test-plans` if the routine already has one (update it with `git pull --ff-only`). Otherwise clone it next to this repo:

```bash
git clone --depth 1 https://github.com/mandreljs/pr-test-plans.git ../pr-test-plans
```

If you can't clone it, carry on anyway. Step 7 explains how to post without the site.

Then find this skill's comment on the PR, if there is one. It's a comment written by the account the routine posts as (`gh api user --jq .login`) that contains `<!-- routine-pr-human-review-plan`:

```bash
gh api repos/mandreljs/mandrel.js/issues/<n>/comments --paginate \
  --jq '.[] | select(.body | contains("<!-- routine-pr-human-review-plan")) | {id, login: .user.login, created_at, body}'
```

If there's more than one (older runs posted new comments), update the newest and leave the others as they are. Then check what already exists for this commit:

- **The comment's marker already says `sha=<full head commit>`.** This commit is done. Stop.
- **A plan file already exists** at `plans/mandrel.js/<n>/<short commit>.json`, but the comment doesn't point at it yet. Don't write another plan; skip to step 8 to update or post the comment.
- Otherwise, carry on and write the plan.

## 3. Gather context

- PR discussion: its description and comments (`gh api repos/mandreljs/mandrel.js/issues/<n>/comments --paginate`).
- Linked issues: issues the PR body refers to (`Fixes`/`Closes`/`Resolves` and plain references), plus issues linked in its timeline (see `GITHUB.md`). Read each issue and its comments. Acceptance criteria and repro steps in issues are the best source of tests.
- The change itself: the diff (`gh api repos/mandreljs/mandrel.js/pulls/<n> -H "Accept: application/vnd.github.diff"`), and read the changed files in full where you need to understand what the tester will actually see. Read them from a separate folder holding the PR's code: reuse `../mandreljs-pr-<n>` if the code review already made it, or create it with `git fetch origin pull/<n>/head && git worktree add --detach ../mandreljs-pr-<n> FETCH_HEAD`. **Don't switch this checkout to the PR branch.** The routine's skills are read from it, so it must stay on `develop`.
- What the tester will see and type. Use these, as they are in the PR's code, rather than function or file names:
  - `apps/game-client/README.md`: the controls, the URL options, and what the overlay shows.
  - `example/maps/README.md`: what each example map has and where things are in it (the start, the step lanes, the enemies).
  - `example/data/*.json`: the names weapons and enemies show in the game, and the numbers a tester might notice.
  - The README's Commands section, `tools/package-readme.md` (what game makers read), and the usage text in `tools/src/mandreljs.ts`: the commands, their options, and what they print.
- Earlier discussion: if a reviewer already reported a bug, or a comment explains how to reach a hidden feature, use it.
- Earlier plans for this PR: other files in `plans/mandrel.js/<n>/`. If there are any, read "Building on earlier plans" in step 4 before deciding what to test.

**There are no preview builds of pull requests.** The published example game (https://mandreljs.github.io/mandrel.js/) is built from `main` only, so it never has the PR's changes. Every plan runs the PR on the tester's own computer (see **Setup** in step 4) and leaves out `preview`. The published game is still useful for comparison: a test can ask the tester to try the same thing there to see how it behaved before, when that's clearer than describing it.

## 4. Decide what to test

Test what a person can see and do: in the game in their browser, in TrenchBroom, or with the `mandreljs` command. Not how the code is built.

- Cover the main thing the PR delivers first, then the edge cases and error paths a person can actually trigger. For the game: each example map it affects (`greybox_01`, `test_movement`, `test_combat`, and any others are opened with `?map=<name>`), more than one browser (Chrome or Edge, Firefox, and Safari on a Mac, since mouse capture and raw mouse input differ between them), a high refresh-rate screen if they have one (the game runs at a fixed 60 ticks a second and must look smooth at any frame rate), switching to another tab and back, pressing **Esc** to free the mouse and clicking back in, dying and starting over, and `?lighting=off` when lighting or map loading changed. For game makers: running a command from a fresh clone (before `npm run setup`), on Windows and on macOS or Linux, and from a game in its own folder outside this repo, as `tools/package-readme.md` describes.
- Movement, weapons, and enemies are about feel, which is hard to check. Turn it into things a tester can see or count, such as "you can walk up the step in the `step18_start` lane without jumping" (`docs/MOVEMENT.md` says which steps should work), or "clicking as fast as you can, the pistol fires about N times a second", with N worked out from the weapon's numbers in `example/data/weapons.json`, never guessed. Then add one test that asks plainly how it feels compared with the published game, and to say what's different in the notes.
- Add a short "Things that should not have changed" section for nearby features the diff touches, so testers catch regressions.
- One behavior per test. Aim for about 5–15 tests in total; a tiny fix may need 2–3. Order them so earlier tests set up later ones (for example, pick up the shotgun before the test that fires it) and say so in `before`.
- Steps are exact actions with exact keys and text ("Press **2**", "Open http://localhost:5173/?map=test_combat", "Type `npx mandreljs compile`"). Name keys as the game uses them. Give keyboard shortcuts for both Mac and Windows when they differ.
- Each expected result is something the tester can see: on screen in the game, in the overlay's text, in a folder, or printed in the terminal. Not "it works" or "the state is correct".
- List anything that can't be checked by hand (refactors, build or CI changes, determinism and golden demos, logic fully covered by unit tests or scenarios) in `notCovered`, in plain words.
- Don't invent behavior. If the PR or issue is unclear about what should happen, write the test for what the code does and say in `why` that the intended behavior isn't stated, so testers can flag it.

**Building on earlier plans.** When the PR already has plans for earlier commits, the new plan builds on them rather than starting from scratch. Testers' results don't carry over between plans, so the new plan must still be **complete**: it tests everything that matters for the PR as it is now, not just the latest changes.

1. **Read the newest earlier plan.** That's the file in `plans/mandrel.js/<n>/` with the latest `generatedAt`; its `pr.commit` is the commit it was written for.
2. **Find what changed since then.** In the PR folder, run `git diff <earlier commit>..<head commit>`, fetching the earlier commit first if git doesn't have it (`git fetch origin <earlier commit>`). If the earlier commit is gone (the branch was force-pushed), compare the PR's full diff with what the earlier plan covers instead.
3. **Read testers' results for earlier plans.** They're PR comments starting with `### 🧪 Manual test results`, and their `[Test plan](…?plan=mandrel.js/<n>/<commit>)` link says which plan they used. Test IDs like `T3` refer to **that** plan's numbering, so match them to test titles in that plan's file. Also read any other comments where people describe testing the PR by hand.
4. **Write the new plan:**
   - Keep tests whose feature didn't change, with the same wording and order, so returning testers recognize them.
   - Update tests whose feature changed, and add tests for new behavior. Start their `why` with "New since commit `<earlier short commit>`." or "Changed since commit `<earlier short commit>`: <what changed>."
   - Make sure everything that **failed or was blocked** in earlier results gets tested again, whether or not the new commits touched it. Start its `why` with "Failed on the plan for commit `<earlier short commit>`: <the tester's note, shortened>." (or "Blocked on …"). If the new commits were meant to fix it, say so.
   - Drop tests for behavior the PR no longer includes, and mention it in the summary.
   - Start the `summary` with one sentence on what changed since the last plan, then describe the PR as a whole.

**Setup** gets a developer with a clone of the repo (or the means to make one) to the first test. Keep it short: don't explain git, npm, or terminals. Put what every test needs in the plan's `setup`, and what only one section needs in that section's own `setup` (it shows as "Before these tests" at the top of the section). For example, linking TrenchBroom goes in the section about editing maps, not at the top. Put each command in a step's `code` field. Include, as needed:

- **What they need:** Node.js 24 or newer, and, only for map editing, TrenchBroom 2026.2 or newer (the README's Getting Started).
- **The PR's code, at exactly this commit**, so testers check the code the plan describes even if more commits land later. This works for PRs from forks too, and in an existing clone (`git clone https://github.com/mandreljs/mandrel.js.git` otherwise):

  ```
  git fetch origin pull/<n>/head
  git checkout <full head commit>
  ```

- **Installing and starting the game:** `npm install`, `npm run setup` (downloads the map compiler the first time; does nothing after that), and `npm run dev`, which keeps running while they test. Then the address to open, such as `http://localhost:5173/?map=greybox_01`. The first load compiles the map, so it takes a moment.
- **Playing:** click inside the game to capture the mouse, **Esc** to get the pointer back, and the controls the tests use (from `apps/game-client/README.md`).
- **Reporting a problem during play:** when something goes wrong in the game, a demo replays it exactly. Press **R** (the level starts over and recording begins), make it happen again, then press **R** again to download a `.demo.json` file, and attach it to the results comment (zip it first if GitHub won't take the file). Include this only in plans that test the game.
- **TrenchBroom**, only for tests that edit maps: `npm run install-trenchbroom`, and the game path it says to set in TrenchBroom's preferences. Saving a map and reloading the page plays the change.
- **A game outside this repo**, only for tests of the `mandreljs` package: `npm run package` makes `dist/mandreljs-<version>.tgz`; then a copy of `example/` in a new folder outside `mandrel.js`, given its own name as `tools/package-readme.md` describes, with `npm install --save-dev <path to the .tgz>` and the `npx mandreljs` commands the tests use.

If the PR has **nothing to check by hand** (docs only, CI, tests only, or an internal refactor with no visible effect), don't write a plan. Changes to the example game's content, the `mandreljs` command, TrenchBroom setup, or a developer command someone runs by hand (such as `rebaseline-demos` or `release`) do need one. When there's nothing to test, post or update the test plan comment instead (step 8), with just the note, marker and heading, then a sentence or two on why no manual testing is needed, and stop. If earlier commits did get plans, keep the "Earlier plans for this PR" list.

## 5. Write the plan

Write the plan to `plans/mandrel.js/<n>/<short commit>.json` in the `pr-test-plans` checkout. The "Plan format" section of that repo's `README.md` is the authority on fields, and `plans/examples/demo-recording/example.json` there is a complete plan that runs on the tester's computer. In short:

```json
{
  "version": 1,
  "project": "Mandrel.js",
  "title": "<PR title as on GitHub>",
  "summary": "Two or three plain sentences: what changed for the player or game maker, and why.",
  "generatedAt": "<current UTC time, e.g. from: date -u +%Y-%m-%dT%H:%M:%SZ>",
  "pr": {
    "repo": "mandreljs/mandrel.js",
    "number": 1234,
    "url": "https://github.com/mandreljs/mandrel.js/pull/1234",
    "branch": "<head.ref>",
    "commit": "<full head commit sha>"
  },
  "links": [
    {
      "label": "Issue 1200: <issue title>",
      "url": "https://github.com/mandreljs/mandrel.js/issues/1200"
    }
  ],
  "setup": [
    {
      "title": "Short step name",
      "body": "What to do, in plain words.",
      "code": "optional command to copy"
    }
  ],
  "sections": [
    {
      "title": "Section name",
      "intro": "Optional one-line description.",
      "setup": [{ "title": "Optional: preparation only this section needs" }],
      "tests": [
        {
          "title": "What this test checks, as a short sentence",
          "why": "Optional: why it matters / which part of the change it covers.",
          "before": "Optional: anything that must be true first.",
          "steps": ["Exact action one.", "Exact action two."],
          "expected": ["What appears on screen."]
        }
      ]
    }
  ],
  "notCovered": ["Optional plain-language list."]
}
```

- Text fields are plain text with three extras: `` `code` ``, `**bold**`, and bare `https://` links. HTML is shown as literal text, and every link must be `https://`. Local addresses like `http://localhost:5173/?map=greybox_01` aren't links; write them as `` `code` `` so testers can copy them.
- Don't number tests yourself. The page numbers them T1, T2, … in reading order.
- Never edit or delete another plan file, even an earlier plan for the same PR.

Check it from the `pr-test-plans` checkout, and fix the JSON until it passes:

```bash
node tools/plan.mjs validate plans/mandrel.js/<n>/<short commit>.json
```

## 6. Publish it

From the `pr-test-plans` checkout, commit **only** the new plan file and push to `main`:

```bash
git add plans/mandrel.js/<n>/<short commit>.json
git commit -m "chore: add test plan for mandrel.js PR <n> (<short commit>)"
git push origin HEAD:main
```

If the push is rejected because `main` moved (another plan landed first), run `git pull --rebase origin main` and push again, up to three times. Plans never touch the same file, so the rebase won't conflict.

Go straight on to the comment once the push succeeds; don't wait for the site to update. The routine's sandbox can't reach `github.io` anyway, and the page tells anyone who clicks too early that new plans take a minute or two to appear.

## 7. If the site can't be used

If cloning, committing, or pushing fails, don't retry in other ways (no other repos, no file hosts, no artifacts). Post or update the comment without the link: keep the heading, note, marker and the plain checklist, and say in one line that the interactive page couldn't be published and why (the error, in plain words). If you couldn't clone the repo, write the checklist by hand in the same shape as `tools/plan.mjs checklist` produces.

## 8. Post or update the comment

Each PR has **one** test plan comment, kept up to date. Make the plain checklist from the `pr-test-plans` checkout:

```bash
node tools/plan.mjs checklist plans/mandrel.js/<n>/<short commit>.json > checklist.md
```

Write the whole comment to a file, in this format with the placeholders filled in:

```markdown
> [!NOTE]
> This test plan was generated by a Claude Code routine set up by Ryan Cook.

<!-- routine-pr-human-review-plan sha=<full head commit> -->

## 🧪 Manual test plan

**[Open the test plan](https://mandreljs.github.io/pr-test-plans/?plan=mandrel.js/<n>/<short commit>)** · <N> tests · written for commit `<short commit>` on <date, e.g. Oct 7, 2026>

Work through the tests on the page and mark each one. Your results save in your browser, so you can stop and come back. When you're done, choose **Copy results** and paste them in a comment here. A brand-new plan can take a couple of minutes to appear on the site.

<details>
<summary>Plain checklist (if the page doesn't open for you)</summary>

<contents of checklist.md>

</details>
```

Then post it, or update the existing comment from step 2 in place (both read the body from the file, which avoids shell-quoting problems):

```bash
gh api repos/mandreljs/mandrel.js/issues/<n>/comments -F body=@comment.md                # no comment yet
gh api -X PATCH repos/mandreljs/mandrel.js/issues/comments/<id> -F body=@comment.md      # update the existing one
```

- The main link always points at **this exact commit's plan**, so it's the newest plan for as long as this comment shows it.
- **If the PR has plans for earlier commits**, add this line under the instructions paragraph: "This plan replaced earlier ones as the PR changed. Results don't carry over between plans, so start fresh on this one. Tests that are new, changed, or failed last time say so at the top." Then, after the checklist, add a folded list of those plans, newest first, so their links aren't lost when the comment is updated:

  ```markdown
  <details>
  <summary>Earlier plans for this PR</summary>

  - [Commit `abc1234`](https://mandreljs.github.io/pr-test-plans/?plan=mandrel.js/<n>/abc1234) · Oct 3, 2026
  - …

  </details>
  ```

- Keep the blank lines after each `</summary>` and before each `</details>`, or GitHub won't render the markdown inside.
- GitHub doesn't notify anyone when a comment is edited. That's fine: new commits and the new code review comment already do.

**Gotchas**

- GitHub turns `#` followed by a number into a link to that issue or PR. Never write `#1` to mean "item 1". Test IDs are `T1`, `T2`, and plain items are "No. 1".
- A GitHub comment can be at most 65,536 characters. If the checklist would push it over, drop the `<details>` checklist and keep the link.
