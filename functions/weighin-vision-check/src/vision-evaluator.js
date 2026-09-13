export const TOLERANCE_FRACTION = 0.03;
export const CONFIDENCE_THRESHOLD = 0.5;

/**
 * Decides whether a weigh-in photo verifies against the user's declared weight, from
 * the vision model's parsed JSON output. Pulled out of main.js so this decision logic
 * is testable without a real Ollama round-trip.
 */
export function evaluateVisionResult(parsed, declaredWeightKg) {
  const readingKg = typeof parsed.reading_kg === "number" ? parsed.reading_kg : null;
  const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;

  const withinTolerance =
    readingKg !== null &&
    declaredWeightKg !== 0 &&
    Math.abs(readingKg - declaredWeightKg) / declaredWeightKg <= TOLERANCE_FRACTION;

  const visionVerified =
    parsed.scale_visible === true &&
    parsed.person_present === true &&
    withinTolerance &&
    confidence >= CONFIDENCE_THRESHOLD;

  return { visionVerified, confidence };
}
