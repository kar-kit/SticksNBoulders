## feat(editor): a program opens on the calendar

The Program Editor now opens on the Calendar view instead of the Week view.

- `?view=week` and `?view=calendar` are both honoured, and the toggle now writes the choice every time (`view=week` or `view=calendar`) rather than removing the param for the week view.
- A link that names a place still opens the week view: the "Adjust program" links from a clip or Athlete View carry `week`, `day` or `line`, and a bare calendar would leave the coach one click short of the line they asked for. An explicit `?view=calendar` wins over a landing.
- A template (no athlete, so no dates) still always shows the week view.
- The component's own default prop stays `week`; the page passes the real default through `editorViewFrom`. That keeps the component tests that render it bare on the week view they were written for.

### Evidence

Unit: lint, typecheck, 2817 of 2817. The editorViewFrom test now covers default, explicit week, explicit calendar, a landing, a landing overridden by `view=calendar`, and a malformed id.

Live, from a webpack production build of this branch against the instance (the dev server cannot compile a client import of `node:crypto` under webpack, so e2e needs `next build --webpack` plus `next start`): `e2e:calendar` 23/23 (new checks: a bare URL opens the calendar, `?view=week` opens the week), `e2e:editor` 46/46, `e2e:program` 31/31, `e2e:copy` 22/22, `e2e:backoff` 15/15, `e2e:video-required` 26/26, `e2e:athlete-view` 22/22 (the Adjust-program landing). Four scripts that opened the editor and then used week-view controls now click the Week tab first; `e2e:copy` uses `?view=week`.

### Open

Layout research on other coaching apps is in the PR thread, not this change. Short version: the calendar is right as an overview, but the evidence says coaches write in a week or progression view, so opening a day from the calendar must keep dropping into the week view, which it does.
