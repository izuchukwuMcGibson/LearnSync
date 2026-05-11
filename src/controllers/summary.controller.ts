import type { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({
  adapter: new PrismaPg(pool),
});

type ErrorResponse = {
  error: string;
};

type KeyPointPayload = {
  concept: string;
  explanation: string;
};

type GenerateSummaryResponse = {
  noteId: string;
  summary: string;
  keyPoints: KeyPointPayload[];
};

type GeminiCandidate = {
  content?: { parts?: Array<{ text?: string }> };
  finishReason?: string;
};

type GeminiResponse = {
  candidates?: GeminiCandidate[];
};

const normalizeGeminiJson = (input: string): string => {
  return input
    .replace(/,\s*(\}|\])/g, "$1")
    .replace(
      /([{,]\s*)(summary|keyPoints|error|concept|explanation)\s*:/g,
      '$1"$2":',
    )
    .replace(/'([^']*)'/g, '"$1"');
};

export const buildSummaryPrompt = (extractedText: string): string => {
  return `
You are an intelligent study assistant for computer science students.

A student has uploaded their personal study notes on a computer science topic.
Your job is to analyze the content and return a structured JSON response.

STRICT RULES:
- Respond with valid JSON only. No extra text, no markdown, no code blocks.
- The summary must be 3 to 5 sentences maximum — concise and academic in tone.
- Each key point must have a clear concept title and a simple one to two sentence explanation.
- Use simple, student-friendly language. Avoid unnecessary jargon.
- Extract between 3 and 8 key points depending on the richness of the content.
- Do not fabricate information. Only use what is in the notes provided.
- If the content is not related to computer science, return this exact JSON:
  { "error": "Content does not appear to be computer science related." }

RESPONSE FORMAT:
{
  "summary": "string",
  "keyPoints": [
    {
      "concept": "string",
      "explanation": "string"
    }
  ]
}

STUDENT NOTES:
${extractedText}
  `.trim();
};

export const generateSummary = async (
  req: Request<{ noteId: string }>,
  res: Response<GenerateSummaryResponse | ErrorResponse>,
) => {
  const { noteId } = req.params;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!noteId) {
    return res.status(400).json({ error: "noteId is required" });
  }

  if (!apiKey) {
    return res.status(500).json({ error: "GEMINI_API_KEY is not configured" });
  }

  try {
    const note = await prisma.note.findUnique({
      where: { id: noteId },
      select: { id: true, content: true, topic: true },
    });

    if (!note) {
      return res.status(404).json({ error: "Note not found" });
    }

    if (!note.content?.trim()) {
      return res.status(400).json({ error: "Note content is empty" });
    }

    // Keep prompts small to avoid truncation and quota spikes.
    const trimmedContent = note.content.slice(0, 6000);
    const prompt = buildSummaryPrompt(trimmedContent);

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" +
        apiKey,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 2500,
            responseMimeType: "application/json",
          },
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gemini API error:", errorText);
      return res.status(502).json({ error: "Failed to generate summary" });
    }

    const responseText = await response.text();
    let data: GeminiResponse;

    try {
      data = JSON.parse(responseText) as GeminiResponse;
    } catch (parseError) {
      console.error("Failed to parse Gemini response:", parseError);
      return res.status(502).json({ error: "Invalid Gemini response" });
    }

    const candidate = data.candidates?.[0];
    if (!candidate) {
      return res
        .status(502)
        .json({ error: "Summary generation returned empty" });
    }

    if (candidate.finishReason && candidate.finishReason !== "STOP") {
      return res.status(502).json({
        error:
          "Summary generation was truncated. Try again or increase max tokens.",
      });
    }

    const rawText = candidate.content?.parts
      ?.map((part) => part.text ?? "")
      .join("")
      .trim();

    if (!rawText) {
      return res
        .status(502)
        .json({ error: "Summary generation returned empty" });
    }
    const cleanedText = rawText
      .replace(/```json\s*/gi, "")
      .replace(/```/g, "")
      .trim();
    const jsonMatch = cleanedText.match(/{[\s\S]*}/);
    const jsonText = jsonMatch ? jsonMatch[0] : cleanedText;

    let parsed: {
      summary?: string;
      keyPoints?: KeyPointPayload[];
      error?: string;
    };

    try {
      parsed = JSON.parse(jsonText) as {
        summary?: string;
        keyPoints?: KeyPointPayload[];
        error?: string;
      };
    } catch (parseError) {
      try {
        const normalized = normalizeGeminiJson(jsonText);
        parsed = JSON.parse(normalized) as {
          summary?: string;
          keyPoints?: KeyPointPayload[];
          error?: string;
        };
      } catch (secondError) {
        console.error("Failed to parse Gemini JSON:", parseError, rawText);
        console.error("Failed after normalization:", secondError, jsonText);
        return res.status(502).json({ error: "Invalid summary format" });
      }
    }

    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }

    if (!parsed.summary || !parsed.keyPoints?.length) {
      return res
        .status(502)
        .json({ error: "Summary output missing required fields" });
    }

    const summary = parsed.summary;
    const keyPoints = parsed.keyPoints;

    const result = await prisma.$transaction(async (tx) => {
      await tx.note.update({
        where: { id: noteId },
        data: { summary },
      });

      const analysis = await tx.noteAnalysis.upsert({
        where: { noteId },
        update: { summary },
        create: { noteId, summary },
      });

      await tx.keyPoint.deleteMany({ where: { analysisId: analysis.id } });

      await tx.keyPoint.createMany({
        data: keyPoints.map((point) => ({
          analysisId: analysis.id,
          concept: point.concept,
          explanation: point.explanation,
        })),
      });

      return analysis;
    });

    return res.status(200).json({ noteId: result.noteId, summary, keyPoints });
  } catch (error) {
    console.error("Error occurred while generating summary:", error);
    return res.status(500).json({ error: "Failed to generate summary" });
  }
};

export const getSummaryByNoteId = async (
  noteId: string,
): Promise<{ summary: string; keyPoints: KeyPointPayload[] } | null> => {
  const analysis = await prisma.noteAnalysis.findUnique({
    where: { noteId },
    select: {
      summary: true,
      keyPoints: {
        select: {
          concept: true,
          explanation: true,
        },
      },
    },
  });

  if (!analysis || !analysis.summary) return null;

  return {
    summary: analysis.summary,
    keyPoints: analysis.keyPoints,
  };
};

export const getSummary = async (
  req: Request<{ noteId: string }>,
  res: Response,
) => {
  const { noteId } = req.params;

  if (!noteId) {
    return res.status(400).json({ error: "noteId is required" });
  }

  try {
    const data = await getSummaryByNoteId(noteId);

    if (!data) {
      return res
        .status(404)
        .json({ error: "Summary not found for this note." });
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error("Error fetching summary:", error);
    return res.status(500).json({ error: "Failed to fetch summary" });
  }
};
