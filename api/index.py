import uuid
import re
import requests
from requests_html import HTMLSession
from flask import Flask, request, jsonify

app = Flask(__name__)

# Konfigurasi
BASE_URL = "https://metrolagu-wapkiz-mobi.wapkiz.sbs/edit.html"
LOGIN_URL = f"{BASE_URL}?act=login&sess1=smnDB9VRAMwC&sess2=5jvIFoMKVMgFBgZObsVWzjc7ZVUoHxX4DHGZXYdADks&sess3=smnYAtRUDM5GS0kdKZYP0C9ubAcl&sess4=0e0369e2813db7deb26e5937c353aab4"
IMPORT_URL = "https://metrolagu-wapkiz-mobi.wapkiz.sbs/edit-15.html"
SONG_ID = "4"  # ID untuk form dan verifikasi
FILE_URL = "https://samplelib.com/lib/preview/mp3/sample-3s.mp3"
EXPECTED_FILE = "sample-3s.mp3"

# Fungsi utilitas dari script asli
def clean_filename(filename):
    return filename.replace("'", "").replace("&", "and")

def clean_title(title):
    return title.replace('"', '“')

def process_anime_label(album):
    keywords = ["Theme Song", "OP", "ED", "Opening", "Ending", "Movie", r"EP\d+", "Insert Song"]
    anime_name = album
    for keyword in keywords:
        anime_name = re.sub(rf'\b{keyword}\b', '', anime_name, flags=re.IGNORECASE)
    anime_name = re.sub(r'\bED\d+\b', '', anime_name, flags=re.IGNORECASE)
    return ' '.join(anime_name.split()).strip()

def convert_drive_link(drive_link):
    file_id = re.search(r'/d/([a-zA-Z0-9_-]+)', drive_link)
    return f"https://drive.google.com/uc?export=download&id={file_id.group(1)}" if file_id else drive_link

# Proses utama
def process_song(session, song_data):
    try:
        # Langkah 1: Login
        print("Login otomatis ke panel...")
        response = session.get(LOGIN_URL)
        if "act=panel" not in response.url:
            return False, "Login gagal: Tidak redirect ke panel."

        # Langkah 2: Akses halaman import
        print("Akses halaman import...")
        response = session.get(IMPORT_URL)
        if "ref=nosess" in response.url:
            print("Redirect ke nosess, mencoba login ulang...")
            response = session.get(LOGIN_URL)
            response = session.get(IMPORT_URL)

        # Langkah 3: Submit link import
        print("Submit link MP3 ke form import...")
        import_data = {
            "url": song_data["driveLink"],
            "import": "Import"
        }
        response = session.post(f"{BASE_URL}?act=filemanager&dir=1&prt=import", data=import_data, allow_redirects=True)
        if "act=filemanager&dir=1" not in response.url or "prt=import" in response.url:
            return False, f"Import gagal untuk {song_data['driveFileNames']}."

        # Langkah 4: Verifikasi file di file manager
        print("Memeriksa daftar file di file manager...")
        response = session.get(f"{BASE_URL}?act=filemanager&dir=1")
        if EXPECTED_FILE not in response.text:
            print("File tidak ditemukan di file manager.")
            print("Daftar file:", [line for line in response.text.splitlines() if "<a href=" in line and ".mp3" in line])
            return False, f"File {EXPECTED_FILE} tidak ditemukan di file manager."

        # Langkah 5: Kunjungi halaman verifikasi
        print("Mengunjungi halaman verifikasi untuk ID 4...")
        response = session.get(f"https://metrolagu-wapkiz-mobi.wapkiz.sbs/edit-16.html?to-file={SONG_ID}")
        if EXPECTED_FILE not in response.text:
            return False, f"File dengan ID {SONG_ID} tidak ditemukan di verifikasi."

        # Langkah 6: Submit form pertama (edit file metadata)
        print("Mengisi form edit file untuk ID 4...")
        form1_data = {
            "name": song_data["driveFileNames"],
            "title": song_data["fileNames"],
            "var-title": song_data["fileNames"],
            "var-album": song_data["albums"],
            "var-anime": song_data["anime_label"],
            "var-genre": song_data["genres"],
            "var-bitrate": "320028",
            "description": song_data["years"],
            "var-duration": song_data["duration"],
            "var-link2": song_data["driveLink"],
            "set_fm": "edit"
        }
        response = session.post(f"{BASE_URL}?act=filemanager&dir=1&view={SONG_ID}&prt=edit", data=form1_data, allow_redirects=True)
        if "act=filemanager" not in response.url:
            return False, "Pengisian form edit gagal: Tidak redirect ke file manager."

        # Langkah 7: Kunjungi ulang halaman verifikasi
        print("Mengunjungi ulang halaman verifikasi untuk ID 4...")
        response = session.get(f"https://metrolagu-wapkiz-mobi.wapkiz.sbs/edit-16.html?to-file={SONG_ID}")
        if EXPECTED_FILE not in response.text:
            return False, f"File dengan ID {SONG_ID} tidak ditemukan di verifikasi ulang."

        # Langkah 8: Submit form kedua (edit tag MP3)
        print("Mengisi form edit tag MP3 untuk ID 4...")
        form2_data = {
            "foto": "",
            "title": song_data["fileNames"],
            "artist": song_data["artists"],
            "album": song_data["albums"],
            "composer": "meownime.wapkiz.com",
            "set": "Save"
        }
        response = session.post(f"{BASE_URL}?act=filemanager&prt=edit_tag&mid={SONG_ID}&dir=1", data=form2_data, allow_redirects=True)
        if "act=filemanager" not in response.url:
            return False, "Pengisian form tag MP3 gagal: Tidak redirect ke file manager."

        return True, f"Berhasil memproses {song_data['driveFileNames']}."

    except Exception as e:
        return False, f"Error: {str(e)}"

@app.route("/import", methods=["POST"])
def import_song():
    # Data contoh untuk testing (mirip struktur JSON di script asli)
    song_data = {
        "id": SONG_ID,
        "driveLink": FILE_URL,
        "driveFileNames": EXPECTED_FILE,
        "fileNames": "Test Song",
        "albums": "Test Album",
        "artists": "Test Artist",
        "genres": "Pop",
        "years": "2025",
        "duration": "0:03",
        "anime_label": process_anime_label("Test Album")
    }

    # Inisialisasi sesi HTTP
    session = HTMLSession()
    session.headers.update({"User-Agent": "Mozilla/5.0 (Linux; Android 10; Mobile)"})

    # Proses lagu
    success, message = process_song(session, song_data)
    session.close()

    return jsonify({
        "success": success,
        "message": message,
        "song_id": song_data["id"]
    })

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
