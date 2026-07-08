export const parseGeminiResponse = <T>(rawResponse: string): T => {
  const cleaned = rawResponse
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "");

  try {
    return JSON.parse(cleaned) as T;
  } catch (error) {
    console.error("Failed to parse Gemini response:", error, cleaned);
    throw new Error(
      "Gemini returned malformed JSON - could not parse response.",
    );
  }
};

export const normalizeGeminiJson = (input: string): string => {
  return input
    .replace(/,\s*(\}|\])/g, "$1")
    .replace(
      /([{,]\s*)(summary|keyPoints|error|concept|explanation|difficulty|questions|id|type|question|options|correctAnswer|starterCode|testCode|language|expectedOutput)\s*:/g,
      '$1"$2":',
    )
    .replace(/'([^']*)'/g, '"$1"');
};
