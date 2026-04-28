import multer from "multer";

const allowedMimeTypes = new Set([
	"application/pdf",
	"application/msword",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

// Store file in memory and validate type/size
const upload = multer({
	storage: multer.memoryStorage(),
	limits: {
		fileSize: 20 * 1024 * 1024, // 20MB
	},
	fileFilter: (_req, file, cb) => {
		if (allowedMimeTypes.has(file.mimetype)) {
			return cb(null, true);
		}

		return cb(new Error("Only Word (.doc, .docx) and PDF files are allowed."));
	},
});

export const uploadNote = upload.single("note");
