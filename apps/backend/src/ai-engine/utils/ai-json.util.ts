/**
 * Defensive JSON parsing for vision/OCR model replies.
 *
 * Extracted from `MemberBulkScannerService.parseAiJson` so every scanner
 * shares one hardened implementation instead of each re-deriving a fragile
 * `content.startsWith('```')` check. A `startsWith` guard misses the two
 * shapes the model actually emits in production:
 *   - a fence preceded by a newline or by prose ("Aquí está el JSON:\n```json")
 *   - a bare object wrapped in trailing commentary
 *
 * NOTE: this does NOT recover truncated output. A cut-off object has no
 * closing brace, so `lastIndexOf('}')` yields a broken slice and the parse
 * throws. Truncation must be diagnosed from `ai_engine_logs`
 * (`completion_tokens == max_tokens`) and fixed by shrinking the model's
 * OUTPUT via the prompt — never by blindly raising `max_tokens`, which makes
 * the gateway answer `402 requires more credits, or fewer max_tokens`.
 */
export function parseAiJson(raw: string): unknown {
  let content = String(raw ?? '').trim();

  // 1) Prefer the contents of a fenced block found ANYWHERE, not only at
  //    offset 0.
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) {
    content = fenceMatch[1].trim();
  }

  // 2) First attempt: parse the (de-fenced) content as-is.
  try {
    return JSON.parse(content);
  } catch {
    // 3) Fallback: widest JSON-object substring. Handles leading/trailing
    //    prose around a single object.
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(content.slice(start, end + 1));
    }
    throw new Error('No JSON object found in AI response');
  }
}
