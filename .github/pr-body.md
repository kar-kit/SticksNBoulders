## fix(audit): one file name per actor in the bucket rename probe

First live `appwrite:audit` after PR #66 failed one cell of 524: "avatars / update / A's coach: rename the file -- should be refused, it succeeded".

It was the probe, not the permissions. Every actor asked to rename the file to the same name. Athlete A is allowed to, so they changed it first; the coach's identical request then changed nothing, and an update that changes nothing is never checked against permissions, so it "succeeded". The video bucket never showed this because nobody may update a clip.

Each actor now renames to a name of their own. Re-run against the live instance: **524/524**, coach update on avatars refused.

Why it matters: the audit is the only check that a refusal is real. A probe that can read a refusal as success would let a genuine hole through the same way.
