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

type DifficultyLevel = "easy-medium" | "medium-hard";

type MCQQuestion = {
  id: number;
  type: "mcq";
  question: string;
  options: { A: string; B: string; C: string; D: string };
  correctAnswer: "A" | "B" | "C" | "D";
  explanation: string;
  difficulty: "easy" | "medium" | "hard";
};

type CodeQuestion = {
  id: number;
  type: "code";
  question: string;
  starterCode: string;
  testCode: string; // Hidden code appended during execution to test the student's solution
  language: string;
  expectedOutput: string;
  explanation: string;
  difficulty: "easy" | "medium" | "hard";
};

type QuizQuestion = MCQQuestion | CodeQuestion;

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
Your job is to generate exactly 10 questions based strictly on the notes provided.

DIFFICULTY LEVEL: ${
    difficulty === "easy-medium"
      ? "EASY TO MEDIUM (Round 1)"
      : "MEDIUM TO HARD (Round 2)"
  }

DIFFICULTY BREAKDOWN:
${difficultyGuide}

QUESTION TYPES:
- If the notes contain programming or code-related content, include 2 to 3 code questions where the student must write or complete a piece of code. The remaining questions should be multiple choice.
- If the notes do not contain programming content, all 10 questions must be multiple choice.
- Multiple choice questions must have exactly 4 options labeled A, B, C, D with one correct answer.
- Code questions must include: 
    1. A clear instruction detailing a specific function name to implement.
    2. A starter code scaffold consisting ONLY of the functional declaration signature block.
    3. The primary programming language string (e.g., javascript, python).
    4. An array of test cases. Each test case MUST explicitly state the literal string snippet that invokes the function (e.g. "doubleNumbers([1, 2, 3])") and the exact literal data structure value it evaluates to (e.g. "[2, 4, 6]").

STRICT RULES:
- Respond with valid JSON only. No extra text, no markdown, no code blocks.
- Generate exactly 10 questions — no more, no less.
- Base every question strictly on the content of the notes. Do not fabricate or go outside the notes.
- Distractors (wrong answers) must be plausible and relevant — not obviously wrong.
- Do not repeat similar questions.
- Keep language clear and student friendly.
- Include a brief explanation for the correct answer to aid learning.

CRITICAL REQUIREMENT FOR CODE QUESTIONS:
You must guarantee absolute cohesion between test case invocations and the target expected return value. Do not guess outputs. Double-check that your expected string exactly mirrors what the invocation creates mathematically.

RESPONSE FORMAT:
{
  "difficulty": "${difficulty}",
  "questions": [
    {
      "id": 1,
      "type": "mcq",
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
    },
    {
      "id": 2,
      "type": "code",
      "question": "string — clear prompt explaining requirements and naming expectations.",
      "starterCode": "string — functional declaration outline shown to the user.",
      "language": "javascript" | "python",
      "testCases": [
        {
          "invocation": "doubleNumbers([1, 2, 3])",
          "expected": "[2, 4, 6]"
        },
        {
          "invocation": "doubleNumbers([5, 10])",
          "expected": "[10, 20]"
        }
      ],
      "explanation": "string — conceptual summary description",
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
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=" +
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
    return parseGeminiResponse<QuizPayload>(jsonText);
  } catch {
    const normalized = normalizeGeminiJson(jsonText);
    return parseGeminiResponse<QuizPayload>(normalized);
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

export const submitQuizScore = async (
  req: Request<{ quizId: string }, {}, { score: number }>,
  res: Response,
) => {
  const { quizId } = req.params;
  const { score } = req.body;

  if (typeof score !== "number") {
    return res.status(400).json({ error: "score must be a number" });
  }

  try {
    const quiz = await prisma.quiz.findUnique({
      where: { id: quizId },
    });

    if (!quiz) {
      return res.status(404).json({ error: "Quiz not found" });
    }

    const attempt = await prisma.attempt.create({
      data: {
        quizId,
        score,
      },
    });

    return res
      .status(201)
      .json({ message: "Score submitted successfully", attempt });
  } catch (error) {
    console.error("Error occurred while submitting quiz score:", error);
    return res.status(500).json({ error: "Failed to submit quiz score" });
  }
};
