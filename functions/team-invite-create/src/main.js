import { Client, TablesDB, Teams, ID, Query } from 'node-appwrite';
import { generateCode } from './code-generator.js';

const DATABASE_ID = 'sticksnboulders';

// Any team member can fetch/mint the team's invite code. Membership is verified
// server-side via the Teams API so a client can't mint a code for a team it isn't in.
async function main({ req, res, error }) {
  const userId = req.headers['x-appwrite-user-id'];
  if (!userId) return res.json({ error: 'Unauthorized' }, 401);

  const { teamId } = JSON.parse(req.body || '{}');
  if (!teamId) return res.json({ error: 'teamId is required' }, 400);

  // Uses a static, manually-provisioned APPWRITE_API_KEY rather than the dynamic
  // per-execution key Appwrite injects: on this server build the dynamic key silently
  // no-ops on row writes (confirmed by comparing against admin-key and session-authed
  // writes, which both persist correctly) instead of failing loudly.
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY ?? '');
  const teams = new Teams(client);
  const tablesDB = new TablesDB(client);

  try {
    const memberships = await teams.listMemberships(teamId, [Query.equal('userId', userId)]);
    if (memberships.total === 0) {
      return res.json({ error: 'Not a member of this team' }, 403);
    }

    const existing = await tablesDB.listRows(DATABASE_ID, 'team_invite_codes', [
      Query.equal('teamId', teamId),
      Query.equal('active', true),
    ]);
    if (existing.total > 0) {
      return res.json({ code: existing.rows[0].code });
    }

    const code = generateCode();
    await tablesDB.createRow(DATABASE_ID, 'team_invite_codes', ID.unique(), {
      teamId,
      code,
      active: true,
    });
    return res.json({ code });
  } catch (err) {
    error(err.message);
    return res.json({ error: 'Failed to create invite code' }, 500);
  }
}

export default main;
