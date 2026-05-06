import type { Request, Response } from "express";
import type { Note } from "@prisma/client";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({
  adapter: new PrismaPg(pool),
});

type SaveNoteBody = {
  userId: string;
  topic: string;
};

type ErrorResponse = {
  error: string;
};

type SaveNoteResponse = {
  note: Note;
  text: string;
};

export const saveNote = async (
  req: Request<{}, {}, SaveNoteBody>,
  res: Response<SaveNoteResponse | ErrorResponse>,
) => {
  try {
    const file = req.file;
    const { userId, topic } = req.body;

    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    if (!userId || !topic) {
      return res.status(400).json({ error: "userId and topic are required" });
    }

    let extractedText = "";

    if (file.mimetype === "application/pdf") {
      const parser = new PDFParse({ data: file.buffer });
      try {
        const parsed = await parser.getText();
        extractedText = parsed.text;
      } finally {
        await parser.destroy();
      }
    } else if (
      file.mimetype ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      extractedText = result.value;
    } else {
      return res
        .status(400)
        .json({ error: "Only PDF and DOCX files are supported" });
    }

    const noteData = {
      userId,
      fileName: file.originalname,
      topic,
      content: extractedText,
    };

    const savedNote = await prisma.note.create({ data: noteData });

    return res.status(200).json({ note: savedNote, text: extractedText });
  } catch (error) {
    console.error("Error occurred while saving note:", error);
    return res.status(500).json({ error: "Failed to extract text from file" });
  }
};

type NotesSummary = {
  id: string;
  topic: string;
};

type GetNotesResponse = {
  count: number;
  notes: NotesSummary[];
};

export const getNotes = async (
  req: Request<{ userId: string }, {}, {}>,
  res: Response<GetNotesResponse | ErrorResponse>,
) => {
  const { userId } = req.params;
  try {
    const notes = await prisma.note.findMany({
      where: { userId },
      select: { id: true, topic: true },
    });

    return res.status(200).json({ count: notes.length, notes });
  } catch (error) {
    console.error("Error occurred while fetching notes:", error);
    return res.status(500).json({ error: "Failed to fetch notes" });
  }
};

export const getNoteById = async (
  req: Request<{ noteId: string }, {}, {}>,
  res: Response<Note | ErrorResponse>,
) => {
  const { noteId } = req.params;
  try {
    const note = await prisma.note.findUnique({ where: { id: noteId } });
    if (!note) {
      return res.status(404).json({ error: "Note not found" });
    }
    return res.status(200).json(note);
  } catch (error) {
    console.error("Error occurred while fetching note:", error);
    return res.status(500).json({ error: "Failed to fetch note" });
  }
};

export const deleteNote = async (
  req: Request<{ noteId: string }, {}, {}>,
  res: Response<{ message: string } | ErrorResponse>,
) => {
  const { noteId } = req.params;
  try {
    const noteExists = await prisma.note.findUnique({ where: { id: noteId } });
    if (!noteExists) {
      return res.status(404).json({ error: "Note not found" });
    }

    await prisma.note.delete({ where: { id: noteId } });

    return res.status(200).json({ message: "Note deleted successfully" });
  } catch (error) {
    console.error("Error occurred while deleting note:", error);
    return res.status(500).json({ error: "Failed to delete note" });
  }
};
