import {
  evaluateVisionResult,
  TOLERANCE_FRACTION,
  CONFIDENCE_THRESHOLD,
} from "../vision-evaluator.js";

function goodResult(overrides = {}) {
  return {
    scale_visible: true,
    person_present: true,
    reading_kg: 80,
    confidence: 0.9,
    ...overrides,
  };
}

describe("evaluateVisionResult", () => {
  it("verifies a clean, matching result", () => {
    const { visionVerified } = evaluateVisionResult(goodResult(), 80);
    expect(visionVerified).toBe(true);
  });

  it("flags when the scale isn't visible", () => {
    const { visionVerified } = evaluateVisionResult(goodResult({ scale_visible: false }), 80);
    expect(visionVerified).toBe(false);
  });

  it("flags when no person is present", () => {
    const { visionVerified } = evaluateVisionResult(goodResult({ person_present: false }), 80);
    expect(visionVerified).toBe(false);
  });

  it("flags when the reading is null (unreadable)", () => {
    const { visionVerified } = evaluateVisionResult(goodResult({ reading_kg: null }), 80);
    expect(visionVerified).toBe(false);
  });

  it("flags when reading_kg is missing entirely from the model output", () => {
    const { visionVerified } = evaluateVisionResult(goodResult({ reading_kg: undefined }), 80);
    expect(visionVerified).toBe(false);
  });

  it("flags when the reading is a non-numeric type (e.g. a string)", () => {
    const { visionVerified } = evaluateVisionResult(goodResult({ reading_kg: "80" }), 80);
    expect(visionVerified).toBe(false);
  });

  it("verifies right at the tolerance boundary (exactly 3% off)", () => {
    const declared = 100;
    const reading = declared * (1 + TOLERANCE_FRACTION);
    const { visionVerified } = evaluateVisionResult(goodResult({ reading_kg: reading }), declared);
    expect(visionVerified).toBe(true);
  });

  it("flags just past the tolerance boundary", () => {
    const declared = 100;
    const reading = declared * (1 + TOLERANCE_FRACTION) + 0.01;
    const { visionVerified } = evaluateVisionResult(goodResult({ reading_kg: reading }), declared);
    expect(visionVerified).toBe(false);
  });

  it("flags a reading below tolerance too (not just above)", () => {
    const declared = 100;
    const reading = declared * (1 - TOLERANCE_FRACTION) - 0.01;
    const { visionVerified } = evaluateVisionResult(goodResult({ reading_kg: reading }), declared);
    expect(visionVerified).toBe(false);
  });

  it("verifies right at the confidence threshold", () => {
    const { visionVerified } = evaluateVisionResult(
      goodResult({ confidence: CONFIDENCE_THRESHOLD }),
      80
    );
    expect(visionVerified).toBe(true);
  });

  it("flags just below the confidence threshold", () => {
    const { visionVerified } = evaluateVisionResult(
      goodResult({ confidence: CONFIDENCE_THRESHOLD - 0.01 }),
      80
    );
    expect(visionVerified).toBe(false);
  });

  it("treats a missing/non-numeric confidence as 0", () => {
    const { visionVerified, confidence } = evaluateVisionResult(
      goodResult({ confidence: undefined }),
      80
    );
    expect(confidence).toBe(0);
    expect(visionVerified).toBe(false);
  });

  it("does not divide by zero when declaredWeightKg is 0", () => {
    const { visionVerified, confidence } = evaluateVisionResult(goodResult(), 0);
    expect(visionVerified).toBe(false);
    expect(Number.isFinite(confidence)).toBe(true);
  });

  it("still returns the model's confidence even when flagged", () => {
    const { confidence } = evaluateVisionResult(goodResult({ scale_visible: false }), 80);
    expect(confidence).toBe(0.9);
  });

  it("handles a completely empty parsed object without throwing", () => {
    expect(() => evaluateVisionResult({}, 80)).not.toThrow();
    expect(evaluateVisionResult({}, 80).visionVerified).toBe(false);
  });
});
