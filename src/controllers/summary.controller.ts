import type { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { normalizeGeminiJson, parseGeminiResponse } from "../utils/gemini.js";

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
  diagramSyntax: string;
};

type GeminiCandidate = {
  content?: { parts?: Array<{ text?: string }> };
  finishReason?: string;
};

type GeminiResponse = {
  candidates?: GeminiCandidate[];
};

export const buildSummaryPrompt = (extractedText: string): string => {
  return `
You are an intelligent study assistant for computer science students.

A student has uploaded their personal study notes on a computer science topic.
Your job is to analyze the content and return a structured JSON response.

STRICT RULES:
- Respond with valid JSON only. No extra text, no markdown, no code blocks.
- The summary must be 3 to 5 sentences maximum — concise and academic in tone.
- Each key point must have a clear concept title and a short explanation (one to two sentences) followed by a concrete example.
- Every explanation must include at least one concrete example illustrating the concept. If the concept is code-related, the example must be a short code snippet (not just a description), kept to a few lines at most.
- Within the JSON string, write code examples on a single logical line using \\n for line breaks and escape any double quotes as \\". Do not use literal newlines inside the string value.
- Use simple, student-friendly language. Avoid unnecessary jargon.
- Extract between 3 and 8 key points depending on the richness of the content.
- Create a concise Mermaid flowchart showing the relationships among the extracted key points. Use only flowchart syntax beginning with "flowchart TD" and plain node labels. Do not use markdown code fences, Mermaid directives, styling, click handlers, or HTML.
- The diagramSyntax value must be a valid JSON string. Represent line breaks with \\n, escape double quotes as \", and use short, stable node IDs such as A, B, and C.
- Do not fabricate information. Only use what is in the notes provided.
- If the content is not related to computer science, return this exact JSON:
  { "error": "Content does not appear to be computer science related." }

RESPONSE FORMAT:
{
  "summary": "string",
  "diagramSyntax": "flowchart TD\\n  A[Concept] --> B[Related concept]",
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
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=" +
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
      diagramSyntax?: string;
      error?: string;
    };

    try {
      parsed = parseGeminiResponse<{
        summary?: string;
        keyPoints?: KeyPointPayload[];
        diagramSyntax?: string;
        error?: string;
      }>(jsonText);
    } catch (parseError) {
      try {
        const normalized = normalizeGeminiJson(jsonText);
        parsed = parseGeminiResponse<{
          summary?: string;
          keyPoints?: KeyPointPayload[];
          diagramSyntax?: string;
          error?: string;
        }>(normalized);
      } catch (secondError) {
        console.error("Failed to parse Gemini JSON:", parseError, rawText);
        console.error("Failed after normalization:", secondError, jsonText);
        return res.status(502).json({ error: "Invalid summary format" });
      }
    }

    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }

    if (!parsed.summary || !parsed.keyPoints?.length || !parsed.diagramSyntax) {
      return res
        .status(502)
        .json({ error: "Summary output missing required fields" });
    }

    const summary = parsed.summary;
    const keyPoints = parsed.keyPoints;
    const diagramSyntax = parsed.diagramSyntax;

    const result = await prisma.$transaction(
      async (tx) => {
        await tx.note.update({
          where: { id: noteId },
          data: { summary },
        });

        const analysis = await tx.noteAnalysis.upsert({
          where: { noteId },
          update: { summary, diagramSyntax },
          create: { noteId, summary, diagramSyntax },
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
      },
      {
        maxWait: 15000,
        timeout: 20000,
      },
    );

    return res.status(200).json({
      noteId: result.noteId,
      summary,
      keyPoints,
      diagramSyntax,
    });
  } catch (error) {
    console.error("Error occurred while generating summary:", error);
    return res.status(500).json({ error: "Failed to generate summary" });
  }
};

export const getSummaryByNoteId = async (
  noteId: string,
): Promise<{
  summary: string;
  keyPoints: KeyPointPayload[];
  diagramSyntax: string | null;
  averageScore: number;
  quizAttempts: number;
} | null> => {
  const analysis = await prisma.noteAnalysis.findUnique({
    where: { noteId },
    select: {
      summary: true,
      diagramSyntax: true,
      keyPoints: {
        select: {
          concept: true,
          explanation: true,
        },
      },
    },
  });

  if (!analysis || !analysis.summary) return null;

  const attemptsAggregate = await prisma.attempt.aggregate({
    where: {
      quiz: {
        noteId: noteId,
      },
    },
    _count: {
      _all: true,
    },
    _avg: {
      score: true,
    },
  });

  const quizAttempts = attemptsAggregate._count._all;
  const averageScore = Math.round(attemptsAggregate._avg.score || 0);

  return {
    summary: analysis.summary,
    keyPoints: analysis.keyPoints,
    diagramSyntax: analysis.diagramSyntax,
    averageScore,
    quizAttempts,
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
