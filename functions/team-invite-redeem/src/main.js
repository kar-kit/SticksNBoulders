import { Client, TablesDB, Teams, Query } from 'node-appwrite';

const DATABASE_ID = 'sticksnboulders';

async function main({ req, res, error }) {
  const userId = req.headers['x-appwrite-user-id'];
  if (!userId) return res.json({ error: 'Unauthorized' }, 401);

  const { code } = JSON.parse(req.body || '{}');
  if (!code) return res.json({ error: 'code is required' }, 400);

  // Static APPWRITE_API_KEY, not the dynamic per-execution key -- see team-invite-create.
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY ?? '');
  const teams = new Teams(client);
  const tablesDB = new TablesDB(client);

  try {
    const matches = await tablesDB.listRows(DATABASE_ID, 'team_invite_codes', [
      Query.equal('code', code.toUpperCase()),
      Query.equal('active', true),
    ]);
    if (matches.total === 0) {
      return res.json({ error: 'Invalid or expired code' }, 404);
    }
    const { teamId } = matches.rows[0];

    const existing = await teams.listMemberships(teamId, [Query.equal('userId', userId)]);
    if (existing.total === 0) {
      await teams.createMembership(teamId, ['member'], undefined, userId);
    }

    const team = await teams.get(teamId);
    return res.json({ teamId, teamName: team.name });
  } catch (err) {
    error(err.message);
    return res.json({ error: 'Failed to redeem invite code' }, 500);
  }
}

export default main;
