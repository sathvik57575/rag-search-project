const express = require('express');
const multer = require('multer');
const path = require('path');
const { TextDecoder } = require('util');
const pdfParse = require('pdf-parse');
const documentRag = require('../documentRag');

const router = express.Router();
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 5;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES },
});

class UploadValidationError extends Error {}

function renderUpload(res, statusCode, message, isError = false, successCount = 0) {
  return res.status(statusCode).render('upload', {
    page: 'upload',
    message,
    isError,
    successCount,
  });
}

async function extractText(file) {
  const filename = path.basename(file.originalname || '');
  const extension = path.extname(filename).toLowerCase();

  if (extension === '.pdf') {
    if (file.buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new UploadValidationError('This file is not a valid PDF.');
    }
    let parsed;
    try {
      parsed = await pdfParse(file.buffer);
    } catch (_) {
      throw new UploadValidationError('This PDF could not be read.');
    }
    if (!parsed.text || !parsed.text.trim()) {
      throw new UploadValidationError('No text could be extracted from this PDF. Scanned-image PDFs are not supported.');
    }
    return { filename, contentType: 'application/pdf', text: parsed.text };
  }

  if (extension === '.txt') {
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(file.buffer);
    } catch (_) {
      throw new UploadValidationError('The text file must use UTF-8 encoding.');
    }
    if (!text.trim() || text.includes('\0')) throw new UploadValidationError('The text file is empty or invalid.');
    return { filename, contentType: 'text/plain; charset=utf-8', text };
  }

  throw new UploadValidationError('Only PDF and TXT files are supported.');
}

async function extractFiles(files) {
  const extractedFiles = [];
  for (const file of files) {
    extractedFiles.push({ file, extracted: await extractText(file) });
  }
  return extractedFiles;
}

router.get('/', (req, res) => {
  return renderUpload(res, 200, null);
});

router.post('/', (req, res) => {
  upload.array('documents', MAX_FILES)(req, res, async (uploadError) => {
    if (uploadError) {
      const statusCode = ['LIMIT_FILE_SIZE', 'LIMIT_FILE_COUNT'].includes(uploadError.code) ? 413 : 400;
      const message = uploadError.code === 'LIMIT_FILE_SIZE'
        ? 'Each file must be 10 MB or smaller.'
        : uploadError.code === 'LIMIT_FILE_COUNT'
          ? `Upload no more than ${MAX_FILES} files at a time.`
          : `Upload up to ${MAX_FILES} PDF or TXT files.`;
      return renderUpload(res, statusCode, message, true);
    }
    if (!req.files || req.files.length === 0) {
      return renderUpload(res, 400, 'Choose at least one PDF or TXT file.', true);
    }

    try {
      const extractedFiles = await extractFiles(req.files);
      const indexed = [];
      const unchanged = [];

      for (const { file, extracted } of extractedFiles) {
        let result;
        try {
          result = await documentRag.indexUploadedDocument({
            filename: extracted.filename,
            contentType: extracted.contentType,
            bytes: file.buffer,
            text: extracted.text,
          });
        } catch (_) {
          const completedCount = indexed.length + unchanged.length;
          const prefix = completedCount
            ? `${completedCount} of ${extractedFiles.length} files were processed. `
            : '';
          return renderUpload(
            res,
            503,
            `${prefix}${extracted.filename} could not be indexed. Check the Neon DATABASE_URL, pgvector, and Gemini embedding configuration.`,
            true,
            indexed.length,
          );
        }
        (result.unchanged ? unchanged : indexed).push(extracted.filename);
      }

      const messages = [];
      if (indexed.length) messages.push(`${indexed.length} file(s) added: ${indexed.join(', ')}.`);
      if (unchanged.length) messages.push(`${unchanged.length} file(s) were already in the library: ${unchanged.join(', ')}.`);
      return renderUpload(res, 200, messages.join(' '), false, indexed.length);
    } catch (error) {
      const isFileError = error instanceof UploadValidationError;
      const message = isFileError
        ? error.message
        : 'The file could not be indexed. Check the Neon DATABASE_URL, pgvector, and Gemini embedding configuration.';
      return renderUpload(res, isFileError ? 400 : 503, message, true);
    }
  });
});

module.exports = router;
module.exports.extractText = extractText;
module.exports.extractFiles = extractFiles;