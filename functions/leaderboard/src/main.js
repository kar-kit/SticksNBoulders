import { Client, TablesDB, Teams, Query } from 'node-appwrite';
import { computeDots, epley1RM } from './dots.js';

const DATABASE_ID = 'sticksnboulders';

async function main({ req, res, error }) {
  const callerId = req.headers['x-appwrite-user-id'];
  if (!callerId) return res.json({ error: 'Unauthorized' }, 401);

  const { teamId, liftId } = JSON.parse(req.body || '{}');
  if (!teamId || !liftId) return res.json({ error: 'teamId and liftId are required' }, 400);

  // Static APPWRITE_API_KEY, not the dynamic per-execution key -- see team-invite-create.
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY ?? '');
  const teams = new Teams(client);
  const tablesDB = new TablesDB(client);

  try {
    const memberships = await teams.listMemberships(teamId, [Query.limit(100)]);
    const isMember = memberships.memberships.some((m) => m.userId === callerId);
    if (!isMember) return res.json({ error: 'Not a member of this group' }, 403);

    const entries = await Promise.all(
      memberships.memberships.map(async (member) => {
        let profile;
        try {
          profile = await tablesDB.getRow(DATABASE_ID, 'profiles', member.userId);
        } catch {
          return null; // hasn't finished onboarding
        }

        const [sets, checkIns] = await Promise.all([
          tablesDB.listRows(DATABASE_ID, 'workout_sets', [
            Query.equal('userId', member.userId),
            Query.equal('liftId', liftId),
            Query.equal('isWarmup', false),
            Query.limit(1000),
          ]),
          tablesDB.listRows(DATABASE_ID, 'bodyweight_checkins', [
            Query.equal('userId', member.userId),
            Query.equal('visionVerified', true),
            Query.orderDesc('weekOf'),
            Query.limit(1),
          ]),
        ]);

        if (sets.rows.length === 0 || checkIns.rows.length === 0) return null;

        const best1RM = sets.rows.reduce(
          (best, set) => Math.max(best, epley1RM(set.weightKg, set.reps)),
          0
        );
        const bodyweightKg = checkIns.rows[0].declaredWeightKg;
        const dots = computeDots(best1RM, bodyweightKg, profile.sex);

        return {
          userId: member.userId,
          name: member.userName || 'Lifter',
          estimated1RMKg: best1RM,
          bodyweightKg,
          dots,
        };
      })
    );

    const ranked = entries.filter((e) => e !== null).sort((a, b) => b.dots - a.dots);
    return res.json({ entries: ranked });
  } catch (err) {
    error(err.message);
    return res.json({ error: 'Failed to compute leaderboard' }, 500);
  }
}

export default main;
