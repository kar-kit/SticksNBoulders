# Transactional email on the self-hosted Appwrite

Password reset (Order 3.5), invite emails and verification all need a working
SMTP sender. Without one, Appwrite's `createRecovery` returns
`503 general_smtp_disabled` — which is exactly where the instance sits today.

Provider: **Resend**.

---

## 1. Verify a domain in Resend first

**This is the step that will bite if skipped.** Resend's shared test sender,
`onboarding@resend.dev`, **only delivers to the email address on the Resend
account**. It is for testing your own setup, not for sending to anyone else.

Ruairi and his athletes will receive nothing. The reset flow will appear to
work — Appwrite returns success, the Resend dashboard shows the send — and the
mail silently never arrives.

So: add a domain you own in **Resend → Domains**, complete the DNS records
(SPF, DKIM, and the return-path CNAME), and wait for it to go green. Then send
from something on that domain, e.g. `no-reply@yourdomain.com`.

## 2. Get SMTP credentials

Resend → **API Keys** → create one with send permission. Then:

| Setting  | Value                                        |
| -------- | -------------------------------------------- |
| Host     | `smtp.resend.com`                            |
| Port     | `465` (SSL) — or `587` / `2587` for STARTTLS |
| Username | `resend` — the literal string, lowercase     |
| Password | the API key, including its `re_` prefix      |

No leading or trailing whitespace on the key. Resend recommends 465 if unsure.

## 3. Configure Appwrite

Two routes. The instance-level one is documented and definitely works; the
project-level one is nicer but its interaction with an empty instance-level
host is **[Unverified]**.

### Instance level — the reliable route

On the Appwrite host, edit the `.env` beside `docker-compose.yml`:

```bash
_APP_SMTP_HOST=smtp.resend.com
_APP_SMTP_PORT=465
_APP_SMTP_SECURE=ssl
_APP_SMTP_USERNAME=resend
_APP_SMTP_PASSWORD=re_your_api_key_here
_APP_SYSTEM_EMAIL_ADDRESS=no-reply@yourdomain.com
_APP_SYSTEM_EMAIL_NAME=Sticks N Boulders
```

`_APP_SMTP_SECURE` takes `ssl`, `tls`, or empty. Use `ssl` with 465 and `tls`
with 587. An **empty `_APP_SMTP_HOST` disables all mail sending from the
server**, which is the current state.

Then recreate the stack and confirm the values landed:

```bash
docker compose up -d
docker compose exec appwrite vars | grep _APP_SMTP
```

### Project level — nicer, once the above works

Console → the project → **Settings → SMTP**. Toggle custom SMTP on and enter
the same host, port, username, password, sender name and sender email.

Two things worth knowing:

- Enabling it makes Appwrite **connect immediately**. Wrong credentials fail
  the save rather than failing later at send time, which is a useful check.
- Custom SMTP is a **prerequisite for customising the email templates**
  (Auth → Templates), so branded reset emails depend on it.

**[Unverified]** whether project-level SMTP works while the instance-level
`_APP_SMTP_HOST` is empty. The docs describe the empty instance value as
disabling mail "from the server", which reads as instance-wide. Set the
instance-level variables first; treat project-level as branding on top.

## 4. Verify it works

```bash
npm run smtp:check -- you@yourdomain.com
```

It sends one real reset email and watches Appwrite's failed-jobs queue, which
is what separates *queued* from *actually sent*. A 200 from `createRecovery`
only means Appwrite accepted it; the worker can still fail afterwards, and an
athlete experiences that as silence.

Then check the inbox. Nothing arriving after a clean hand-off means the sender
domain is not verified (§1).

### Doing it by hand

From the repo, with the dev server running:

```bash
npm run dev
npx tsx --env-file-if-exists=.env.local -e "
import { Account, Client } from 'node-appwrite';
const c = new Client()
  .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
  .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!);
await new Account(c).createRecovery({
  email: 'your-own@address.com',
  url: 'http://localhost:3000/sign-in/reset',
});
console.log('accepted — now check the inbox');
"
```

What the outcomes mean:

| Result                             | Meaning                                         |
| ---------------------------------- | ----------------------------------------------- |
| `503 general_smtp_disabled`        | Appwrite still has no SMTP host                 |
| `400 Invalid \`url\` param`        | that origin is not a registered Web platform    |
| accepted, but no email arrives     | almost certainly the unverified-domain trap (§1) |
| accepted and the email arrives     | done                                            |

`createRecovery` returning success only means Appwrite queued it. Always
confirm with a real inbox.

## 5. What the failed-jobs queue tells you

```bash
curl -s "$ENDPOINT/health/queue/failed/v1-mails" \
  -H "X-Appwrite-Project: $PROJECT" -H "X-Appwrite-Key: $KEY"
```

A non-zero size is not necessarily current — failures accumulate and are not
cleared when the config is fixed. What matters is whether the number **goes up
after a fresh send**, which is what `npm run smtp:check` measures.

## 6. Before the Cloud migration

Appwrite Cloud has its own SMTP configuration, so these instance-level
variables do not travel. The Resend domain and API key do. Re-enter them in the
Cloud console when the migration happens in January 2027.
