import { Client, TablesDB, ID, Query } from 'node-appwrite';
import { generateCode } from './code-generator.js';

const DATABASE_ID = 'sticksnboulders';

async function main({ req, res, error }) {
  const userId = req.headers['x-appwrite-user-id'];
  if (!userId) return res.json({ error: 'Unauthorized' }, 401);

  // Static APPWRITE_API_KEY, not the dynamic per-execution key -- see team-invite-create.
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY ?? '');
  const tablesDB = new TablesDB(client);

  try {
    const existing = await tablesDB.listRows(DATABASE_ID, 'coach_invite_codes', [
      Query.equal('coachUserId', userId),
      Query.equal('active', true),
    ]);
    if (existing.total > 0) {
      return res.json({ code: existing.rows[0].code });
    }

    const code = generateCode();
    await tablesDB.createRow(DATABASE_ID, 'coach_invite_codes', ID.unique(), {
      coachUserId: userId,
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
