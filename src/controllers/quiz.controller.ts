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

type DifficultyLevel = "easy-medium" | "medium-hard";

type QuizQuestion = {
  id: number;
  question: string;
  options: { A: string; B: string; C: string; D: string };
  correctAnswer: "A" | "B" | "C" | "D";
  explanation: string;
  difficulty: "easy" | "medium" | "hard";
};

type GenerateQuizResponse = {
  quizId: string;
  questions: QuizQuestion[];
};

type GenerateQuizBody = {
  difficulty?: DifficultyLevel;
};

type QuizPayload = {
  difficulty: DifficultyLevel;
  questions: QuizQuestion[];
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
      /([{,]\s*)(difficulty|questions|id|question|options|correctAnswer|explanation)\s*:/g,
      '$1"$2":',
    )
    .replace(/'([^']*)'/g, '"$1"');
};

export const buildQuizPrompt = (
  extractedText: string,
  difficulty: DifficultyLevel,
): string => {
  const difficultyGuide =
    difficulty === "easy-medium"
      ? `
- Easy questions (5 questions): Test basic recall and definitions.
  Example: "What does LIFO stand for?"
- Medium questions (5 questions): Test understanding and application.
  Example: "Which of the following is a real-world use case of a stack?"`
      : `
- Medium questions (4 questions): Test understanding and application.
  Example: "Which of the following is a real-world use case of a stack?"
- Hard questions (6 questions): Test deep analysis and problem solving.
  Example: "Given the following sequence of push and pop operations, what is the final state of the stack?"`;

  return `
You are a computer science quiz generator for an adaptive learning system.

A student has just read their study notes and is now being tested on their understanding.
Your job is to generate exactly 10 multiple choice questions based strictly on the notes provided.

DIFFICULTY LEVEL: ${
    difficulty === "easy-medium"
      ? "EASY TO MEDIUM (Round 1)"
      : "MEDIUM TO HARD (Round 2)"
  }

DIFFICULTY BREAKDOWN:
${difficultyGuide}

STRICT RULES:
- Respond with valid JSON only. No extra text, no markdown, no code blocks.
- Generate exactly 10 multiple choice questions — no more, no less.
- Each question must have exactly 4 options labeled A, B, C, D.
- Only one option must be correct per question.
- Base every question strictly on the content of the notes. Do not fabricate or go outside the notes.
- Distractors (wrong answers) must be plausible and relevant — not obviously wrong.
- Do not repeat similar questions.
- Keep language clear and student friendly.
- Include a brief explanation for the correct answer to aid learning.

RESPONSE FORMAT:
{
  "difficulty": "${difficulty}",
  "questions": [
    {
      "id": 1,
      "question": "string",
      "options": {
        "A": "string",
        "B": "string",
        "C": "string",
        "D": "string"
      },
      "correctAnswer": "A" | "B" | "C" | "D",
      "explanation": "string",
      "difficulty": "easy" | "medium" | "hard"
    }
  ]
}

STUDENT NOTES:
${extractedText}
	`.trim();
};

const generateQuizFromNote = async (
  content: string,
  difficulty: DifficultyLevel,
): Promise<QuizPayload> => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  // Keep prompts small to avoid truncation and quota spikes.
  const trimmedContent = content.slice(0, 3500);
  const prompt = buildQuizPrompt(trimmedContent, difficulty);

  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" +
      apiKey,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 4000,
          responseMimeType: "application/json",
        },
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText);
  }

  const responseText = await response.text();
  let data: GeminiResponse;

  try {
    data = JSON.parse(responseText) as GeminiResponse;
  } catch {
    throw new Error("Invalid Gemini response");
  }
  const candidate = data.candidates?.[0];

  if (!candidate) {
    throw new Error("Quiz generation returned empty");
  }

  if (candidate.finishReason && candidate.finishReason !== "STOP") {
    throw new Error("Quiz generation was truncated. Try again.");
  }

  const rawText = candidate.content?.parts
    ?.map((part) => part.text ?? "")
    .join("")
    .trim();

  if (!rawText) {
    throw new Error("Quiz generation returned empty");
  }

  const cleanedText = rawText
    .replace(/```json\s*/gi, "")
    .replace(/```/g, "")
    .trim();
  const jsonMatch = cleanedText.match(/{[\s\S]*}/);
  const jsonText = jsonMatch ? jsonMatch[0] : cleanedText;

  try {
    return JSON.parse(jsonText) as QuizPayload;
  } catch {
    const normalized = normalizeGeminiJson(jsonText);
    return JSON.parse(normalized) as QuizPayload;
  }
};

const getRoundForDifficulty = (difficulty: DifficultyLevel): number => {
  return difficulty === "easy-medium" ? 1 : 2;
};

export const markAsRead = async (
  req: Request<{ noteId: string }>,
  res: Response<{ message: string } | ErrorResponse>,
) => {
  const { noteId } = req.params;

  try {
    const analysis = await prisma.noteAnalysis.findUnique({
      where: { noteId },
      select: { id: true },
    });

    if (!analysis) {
      return res.status(404).json({ error: "Note analysis not found" });
    }

    await prisma.noteAnalysis.update({
      where: { noteId },
      data: { isRead: true },
    });

    return res.status(200).json({ message: "Marked as read" });
  } catch (error) {
    console.error("Error occurred while marking as read:", error);
    return res.status(500).json({ error: "Failed to mark as read" });
  }
};

export const generateQuiz = async (
  req: Request<{ noteId: string }, {}, GenerateQuizBody>,
  res: Response<GenerateQuizResponse | ErrorResponse>,
) => {
  const { noteId } = req.params;
  const difficulty = req.body.difficulty ?? "easy-medium";
  if (difficulty !== "easy-medium" && difficulty !== "medium-hard") {
    return res.status(400).json({ error: "Invalid difficulty level" });
  }

  try {
    const analysis = await prisma.noteAnalysis.findUnique({
      where: { noteId },
      select: { isRead: true },
    });

    if (!analysis?.isRead) {
      return res.status(403).json({
        error: "Please read the summary and key points before taking the quiz.",
      });
    }

    const note = await prisma.note.findUnique({
      where: { id: noteId },
      select: { content: true },
    });

    if (!note) {
      return res.status(404).json({ error: "Note not found" });
    }

    if (!note.content?.trim()) {
      return res.status(400).json({ error: "Note content is empty" });
    }

    const quizData = await generateQuizFromNote(note.content, difficulty);
    if (!quizData.questions.length) {
      return res
        .status(400)
        .json({ error: "Not enough content to build quiz" });
    }

    const quiz = await prisma.quiz.create({
      data: {
        noteId,
        questions: quizData.questions,
        difficulty: quizData.difficulty,
        round: getRoundForDifficulty(quizData.difficulty),
      },
    });

    return res
      .status(201)
      .json({ quizId: quiz.id, questions: quizData.questions });
  } catch (error) {
    console.error("Error occurred while generating quiz:", error);
    return res.status(500).json({ error: "Failed to generate quiz" });
  }
};
