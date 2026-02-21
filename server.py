import os
import uuid
import shutil
import zipfile
import subprocess
from flask import Flask, request, send_file, jsonify
from flask_cors import CORS
from werkzeug.utils import secure_filename

app = Flask(__name__)
CORS(app)

PORT = 5000
TEMP_FOLDER = "temp"
ALLOWED_EXTENSIONS = {".pdf", ".docx"}
MAX_FILES = 15
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB

# ============================
# Windows LibreOffice Path
# ============================
LIBREOFFICE_PATH = r"C:\Program Files\LibreOffice\program\soffice.exe"

if not os.path.exists(TEMP_FOLDER):
    os.makedirs(TEMP_FOLDER)


def allowed_file(filename):
    ext = os.path.splitext(filename)[1].lower()
    return ext in ALLOWED_EXTENSIONS


@app.route("/convert", methods=["POST"])
def convert_files():
    if "files" not in request.files:
        return jsonify({"error": "No files uploaded"}), 400

    files = request.files.getlist("files")

    if len(files) == 0:
        return jsonify({"error": "No files uploaded"}), 400

    if len(files) > MAX_FILES:
        return jsonify({"error": "Maximum 15 files allowed"}), 400

    request_id = str(uuid.uuid4())
    output_dir = os.path.join(TEMP_FOLDER, request_id)
    os.makedirs(output_dir)

    uploaded_paths = []

    try:
        # ============================
        # Save & Convert Files
        # ============================
        for file in files:
            filename = secure_filename(file.filename)

            if not allowed_file(filename):
                return jsonify({"error": "Only PDF and DOCX allowed"}), 400

            input_path = os.path.join(TEMP_FOLDER, filename)
            file.save(input_path)
            uploaded_paths.append(input_path)

            ext = os.path.splitext(filename)[1].lower()
            output_format = "docx" if ext == ".pdf" else "pdf"

            subprocess.run([
                LIBREOFFICE_PATH,
                "--headless",
                "--convert-to", output_format,
                "--outdir", output_dir,
                input_path
            ], check=True)

        # ============================
        # Zip Converted Files
        # ============================
        zip_name = f"converted_{uuid.uuid4().hex}.zip"
        zip_path = os.path.join(TEMP_FOLDER, zip_name)

        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for file in os.listdir(output_dir):
                zipf.write(
                    os.path.join(output_dir, file),
                    arcname=file
                )

        # ============================
        # Send ZIP
        # ============================
        return send_file(
            zip_path,
            as_attachment=True,
            download_name=zip_name
        )

    except subprocess.CalledProcessError:
        return jsonify({"error": "Conversion failed"}), 500

    finally:
        # Cleanup
        for path in uploaded_paths:
            if os.path.exists(path):
                os.remove(path)

        if os.path.exists(output_dir):
            shutil.rmtree(output_dir)


if __name__ == "__main__":
    print(f"🚀 Server running on http://localhost:{PORT}")
    app.run(port=PORT, debug=True)