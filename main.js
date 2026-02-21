const express = require("express");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const archiver = require("archiver");
const { exec } = require("child_process");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

// ============================
// Windows LibreOffice Path
// ============================
const libreOfficePath =
  '"C:\\Program Files\\LibreOffice\\program\\soffice.exe"';

// ============================
// Multer Setup
// ============================
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "temp/");
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + "-" + file.originalname);
  },
});

const upload = multer({
  storage: storage,
  limits: {
    files: 15,
    fileSize: 10 * 1024 * 1024, // 10MB limit per file
  },
  fileFilter: (req, file, cb) => {
    const allowed = [".pdf", ".docx"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF and DOCX files allowed"));
    }
  },
}).array("files", 15);

// ============================
// Convert Route
// ============================
app.post("/convert", (req, res) => {
  upload(req, res, async function (err) {
    if (err) {
      return res.status(400).send(err.message);
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).send("No files uploaded.");
    }

    const requestId = uuidv4();
    const outputDir = path.join(__dirname, "temp", requestId);
    fs.mkdirSync(outputDir);

    try {
      for (let file of req.files) {
        const inputPath = path.join(__dirname, file.path);
        const ext = path.extname(file.originalname).toLowerCase();
        const outputFormat = ext === ".pdf" ? "docx" : "pdf";

        await new Promise((resolve, reject) => {
          exec(
            `${libreOfficePath} --headless --convert-to ${outputFormat} --outdir "${outputDir}" "${inputPath}"`,
            (error, stdout, stderr) => {
              if (error) {
                console.error(stderr);
                reject(error);
              } else {
                resolve();
              }
            }
          );
        });
      }

      // ============================
      // Zip Converted Files
      // ============================
      const zipName = `converted_${Date.now()}.zip`;
      const zipPath = path.join(__dirname, zipName);

      const output = fs.createWriteStream(zipPath);
      const archive = archiver("zip", { zlib: { level: 9 } });

      archive.pipe(output);

      fs.readdirSync(outputDir).forEach((file) => {
        archive.file(path.join(outputDir, file), { name: file });
      });

      await archive.finalize();

      output.on("close", () => {
        res.download(zipPath, zipName, () => {
          // Cleanup
          fs.unlinkSync(zipPath);

          req.files.forEach((file) => {
            fs.unlinkSync(path.join(__dirname, file.path));
          });

          fs.rmSync(outputDir, { recursive: true, force: true });
        });
      });

    } catch (error) {
      console.error(error);
      res.status(500).send("Conversion failed.");
    }
  });
});

// ============================
// Start Server
// ============================
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});