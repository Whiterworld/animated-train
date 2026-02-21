import os
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from werkzeug.utils import secure_filename
from docx2pdf import convert

app = Flask(__name__)
CORS(app, origins=['https://wordpdfconvertered.netlify.app'])

UPLOAD_FOLDER = 'uploads'
CONVERTED_FOLDER = 'converted'
ALLOWED_EXTENSIONS = {'docx'}

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(CONVERTED_FOLDER, exist_ok=True)

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route('/convert', methods=['POST'])
def convert_files():
    if 'files' not in request.files:
        return jsonify({"error": "No files uploaded"}), 400

    files = request.files.getlist('files')
    converted_files = []

    for file in files:
        if file.filename == '' or not allowed_file(file.filename):
            continue

        filename = secure_filename(file.filename)
        upload_path = os.path.join(UPLOAD_FOLDER, filename)
        file.save(upload_path)

        output_filename = filename.rsplit('.', 1)[0] + '.pdf'
        output_path = os.path.join(CONVERTED_FOLDER, output_filename)

        try:
            convert(upload_path, output_path)
            converted_files.append(output_filename)
        except Exception as e:
            print(f"Error converting {filename}: {e}")
            continue

    if not converted_files:
        return jsonify({"error": "No valid files converted"}), 400

    return jsonify({"converted": converted_files})

@app.route('/download/<filename>')
def download_file(filename):
    return send_from_directory(CONVERTED_FOLDER, filename, as_attachment=True)

if __name__ == '__main__':
    # Bind to 0.0.0.0 and use Render's PORT
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
