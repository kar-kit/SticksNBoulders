import { Client, TablesDB, Storage } from 'node-appwrite';
import { evaluateVisionResult } from './vision-evaluator.js';

const DATABASE_ID = 'sticksnboulders';
const BUCKET_ID = 'bodyweight_photos';

const VISION_PROMPT = `You are checking a bodyweight scale photo for a fitness app. Look at the image and respond with ONLY a JSON object, no other text, in this exact shape:
{"scale_visible": boolean, "person_present": boolean, "reading_kg": number or null, "confidence": number between 0 and 1}

scale_visible: true if a bathroom/scale display is clearly visible.
person_present: true if a person (or part of a person, e.g. feet) is visible on or at the scale.
reading_kg: the numeric weight shown on the scale display, converted to kilograms if it appears to be in another unit. null if unreadable.
confidence: your confidence in the reading_kg value.`;

// Triggered on the BodyweightCheckIns row create event rather than the storage upload
// event: the client uploads the photo before it creates the row, so a storage-triggered
// function could race ahead of the row that carries declaredWeightKg to compare against.
async function main({ req, res, error }) {
  let payload;
  try {
    payload = JSON.parse(req.body || '{}');
  } catch {
    return res.json({ error: 'Invalid event payload' }, 400);
  }

  const rowId = payload.$id;
  const { photoFileId, declaredWeightKg } = payload;
  if (!rowId || !photoFileId || typeof declaredWeightKg !== 'number') {
    return res.json({ error: 'Missing required fields on row' }, 400);
  }

  // Static APPWRITE_API_KEY, not the dynamic per-execution key -- see team-invite-create.
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY ?? '');
  const storage = new Storage(client);
  const tablesDB = new TablesDB(client);

  const ollamaUrl = process.env.OLLAMA_URL;
  const ollamaModel = process.env.OLLAMA_MODEL || 'gemma3';
  if (!ollamaUrl) {
    error('OLLAMA_URL is not set; skipping vision check and flagging for manual review');
    await tablesDB.updateRow(DATABASE_ID, 'bodyweight_checkins', rowId, {
      visionVerified: false,
      flagged: true,
    });
    return res.json({ skipped: true, reason: 'OLLAMA_URL not configured' });
  }

  try {
    const fileBuffer = await storage.getFileDownload(BUCKET_ID, photoFileId);
    const base64Image = Buffer.from(fileBuffer).toString('base64');

    const ollamaRes = await fetch(new URL('/api/generate', ollamaUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ollamaModel,
        prompt: VISION_PROMPT,
        images: [base64Image],
        stream: false,
        format: 'json',
      }),
    });

    if (!ollamaRes.ok) {
      throw new Error(`Ollama request failed: ${ollamaRes.status}`);
    }

    const { response: rawModelOutput } = await ollamaRes.json();
    const parsed = JSON.parse(rawModelOutput);

    const { visionVerified, confidence } = evaluateVisionResult(parsed, declaredWeightKg);

    await tablesDB.updateRow(DATABASE_ID, 'bodyweight_checkins', rowId, {
      visionVerified,
      visionConfidence: confidence,
      flagged: !visionVerified,
    });

    return res.json({ visionVerified, confidence });
  } catch (err) {
    error(err.message);
    await tablesDB.updateRow(DATABASE_ID, 'bodyweight_checkins', rowId, {
      visionVerified: false,
      flagged: true,
    });
    return res.json({ error: 'Vision check failed, flagged for manual review' }, 500);
  }
}

export default main;
