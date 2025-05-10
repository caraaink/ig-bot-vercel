import uuid
import re
import os
import json
import requests
from requests_html import HTMLSession
from flask import Flask, jsonify
from vercel_storage import kv

app = Flask(__name__)

# Konfigurasi
BASE_URL = "https://metrolagu-wapkiz-mobi.wapkiz.sbs/edit.html"
LOGIN_URL = os.getenv("URL_LOGIN")
IMPORT_URL = "https://metrolagu-wapkiz-mobi.wapkiz.sbs/edit-15.html"
KV_KEY = "songs"  # Kunci untuk data lagu di Vercel KV

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

def process_song(session, song_data):
    try:
        song_id = song_data["id"]
        expected_file = song_data["driveFileNames"]

        # Langkah 1: Login
        print(f"Login otomatis ke panel untuk ID {song_id}...")
        response = session.get(LOGIN_URL)
        if "act=panel" not in response.url:
            return False, f"Login gagal untuk ID {song_id}: Tidak redirect ke panel."

        # Langkah 2: Akses halaman import
        print(f"Akses halaman import untuk ID {song_id}...")
        response = session.get(IMPORT_URL)
        if "ref=nosess" in response.url:
            print("Redirect ke nosess, mencoba login ulang...")
            response = session.get(LOGIN_URL)
            response = session.get(IMPORT_URL)

        # Langkah 3: Submit link import
        print(f"Submit link MP3 untuk ID {song_id}...")
        import_data = {
            "url": song_data["urls"],
            "import": "Import"
        }
        response = session.post(f"{BASE_URL}?act=filemanager&dir=1&prt=import", data=import_data, allow_redirects=True)
        if "act=filemanager&dir=1" not in response.url or "prt=import" in response.url:
            return False, f"Import gagal untuk {song_data['driveFileNames']}."

        # Langkah 4: Verifikasi file di file manager
        print(f"Memeriksa daftar file di file manager untuk ID {song_id}...")
        response = session.get(f"{BASE_URL}?act=filemanager&dir=1")
        if expected_file not in response.text:
            print("File tidak ditemukan di file manager.")
            print("Daftar file:", [line for line in response.text.splitlines() if "<a href=" in line and ".mp3" in line])
            return False, f"File {expected_file} tidak ditemukan di file manager."

        # Langkah 5: Kunjungi halaman verifikasi
        print(f"Mengunjungi halaman verifikasi untuk ID {song_id}...")
        response = session.get(f"https://metrolagu-wapkiz-mobi.wapkiz.sbs/edit-16.html?to-file={song_id}")
        if expected_file not in response.text:
            return False, f"File dengan ID {song_id} tidak ditemukan di verifikasi."

        # Langkah 6: Submit form pertama (edit file metadata)
        print(f"Mengisi form edit file untuk ID {song_id}...")
        form1_data = {
            "name": song_data["driveFileNames"],
            "title": song_data["fileNames"],
            "var-title": song_data["fileNames"],
            "var-album": song_data["albums"],
            "var-anime": process_anime_label(song_data["albums"]),
            "var-genre": song_data["genres"],
            "var-bitrate": "320028",
            "description": song_data["years"],
            "var-duration": song_data["duration"],
            "var-link2": song_data["urls"],
            "set_fm": "edit"
        }
        response = session.post(f"{BASE_URL}?act=filemanager&dir=1&view={song_id}&prt=edit", data=form1_data, allow_redirects=True)
        if "act=filemanager" not in response.url:
            return False, f"Pengisian form edit gagal untuk ID {song_id}: Tidak redirect ke file manager."

        # Langkah 7: Kunjungi ulang halaman verifikasi
        print(f"Mengunjungi ulang halaman verifikasi untuk ID {song_id}...")
        response = session.get(f"https://metrolagu-wapkiz-mobi.wapkiz.sbs/edit-16.html?to-file={song_id}")
        if expected_file not in response.text:
            return False, f"File dengan ID {song_id} tidak ditemukan di verifikasi ulang."

        # Langkah 8: Submit form kedua (edit tag MP3)
        print(f"Mengisi form edit tag MP3 untuk ID {song_id}...")
        form2_data = {
            "foto": "",
            "title": song_data["fileNames"],
            "artist": song_data["artists"],
            "album": song_data["albums"],
            "composer": "meownime.wapkiz.com",
            "set": "Save"
        }
        response = session.post(f"{BASE_URL}?act=filemanager&prt=edit_tag&mid={song_id}&dir=1", data=form2_data, allow_redirects=True)
        if "act=filemanager" not in response.url:
            return False, f"Pengisian form tag MP3 gagal untuk ID {song_id}: Tidak redirect ke file manager."

        return True, f"Berhasil memproses {song_data['driveFileNames']}."

    except Exception as e:
        return False, f"Error untuk ID {song_data['id']}: {str(e)}"

@app.route("/api/import", methods=["POST"])
def import_songs():
    try:
        # Ambil data lagu dari Vercel KV
        songs = kv.get(KV_KEY)
        if not songs:
            return jsonify({"success": False, "message": "Tidak ada data lagu di KV.", "results": []})

        songs = json.loads(songs) if isinstance(songs, str) else songs
        results = []

        # Inisialisasi sesi HTTP
        session = HTMLSession()
        session.headers.update({"User-Agent": "Mozilla/5.0 (Linux; Android 10; Mobile)"})

        # Proses setiap lagu
        for song in songs:
            success, message = process_song(session, song)
            results.append({
                "id": song["id"],
                "driveFileNames": song["driveFileNames"],
                "success": success,
                "message": message
            })

        session.close()

        return jsonify({
            "success": all(r["success"] for r in results),
            "message": "Proses import selesai.",
            "results": results
        })

    except Exception as e:
        return jsonify({
            "success": False,
            "message": f"Error saat memproses import: {str(e)}",
            "results": []
        })

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
