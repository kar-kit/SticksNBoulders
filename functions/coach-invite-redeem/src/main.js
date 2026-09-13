import { Client, TablesDB, Users, ID, Permission, Role, Query } from 'node-appwrite';

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
  const tablesDB = new TablesDB(client);
  const users = new Users(client);

  try {
    const matches = await tablesDB.listRows(DATABASE_ID, 'coach_invite_codes', [
      Query.equal('code', code.toUpperCase()),
      Query.equal('active', true),
    ]);
    if (matches.total === 0) {
      return res.json({ error: 'Invalid or expired code' }, 404);
    }
    const { coachUserId } = matches.rows[0];
    if (coachUserId === userId) {
      return res.json({ error: 'You cannot link to yourself as a coach' }, 400);
    }

    const existingLink = await tablesDB.listRows(DATABASE_ID, 'coach_links', [
      Query.equal('coachUserId', coachUserId),
      Query.equal('athleteUserId', userId),
    ]);
    if (existingLink.total > 0) {
      return res.json({ coachUserId });
    }

    const [coachAccount, athleteAccount] = await Promise.all([
      users.get(coachUserId),
      users.get(userId),
    ]);

    await tablesDB.createRow(
      DATABASE_ID,
      'coach_links',
      ID.unique(),
      {
        coachUserId,
        athleteUserId: userId,
        status: 'active',
        inviteCodeUsed: code.toUpperCase(),
        coachName: coachAccount.name || null,
        athleteName: athleteAccount.name || null,
      },
      [
        Permission.read(Role.user(coachUserId)),
        Permission.read(Role.user(userId)),
      ]
    );
    return res.json({ coachUserId });
  } catch (err) {
    error(err.message);
    return res.json({ error: 'Failed to redeem invite code' }, 500);
  }
}

export default main;
