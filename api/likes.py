import json
import time
import os
import random
import logging
import requests
from instagrapi import Client
from http import HTTPStatus

# Inisialisasi logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Vercel KV config
KV_URL = os.getenv("KV_REST_API_URL")
KV_TOKEN = os.getenv("KV_REST_API_TOKEN")
KV_HEADERS = {"Authorization": f"Bearer {KV_TOKEN}"}

def get_kv_data(key):
    try:
        response = requests.get(f"{KV_URL}/get/{key}", headers=KV_HEADERS)
        return response.json().get("result")
    except Exception as e:
        logger.error(f"Gagal mengambil {key} dari KV: {str(e)}")
        return None

def set_kv_data(key, value):
    try:
        requests.post(f"{KV_URL}/set/{key}", headers=KV_HEADERS, json={"value": value})
    except Exception as e:
        logger.error(f"Gagal menyimpan {key} ke KV: {str(e)}")

def handler(request):
    try:
        # Ambil data akun dari Vercel KV
        accounts_data = get_kv_data("accounts")
        if not accounts_data:
            logger.error("Tidak ada akun di Vercel KV")
            return {
                "statusCode": HTTPStatus.BAD_REQUEST,
                "body": json.dumps({"error": "Tidak ada akun yang ditemukan"})
            }
        accounts = json.loads(accounts_data)
        if not accounts:
            return {
                "statusCode": HTTPStatus.BAD_REQUEST,
                "body": json.dumps({"error": "Daftar akun kosong"})
            }

        results = []

        # Proses setiap akun
        for account in accounts:
            username = account.get("username")
            password = account.get("password")
            if not username or not password:
                logger.error(f"Data akun tidak valid: {username or 'unknown'}")
                results.append({
                    "username": username or "unknown",
                    "status": "failed",
                    "message": "Data akun tidak valid"
                })
                continue

            logger.info(f"Memproses akun: {username}")
            cl = Client()

            # Cek sesi dari Vercel KV
            session_key = f"session:{username}"
            session_data = get_kv_data(session_key)
            try:
                if session_data:
                    cl.load_settings_dict(json.loads(session_data))
                    cl.login(username, password)  # Verifikasi sesi
                    results.append({
                        "username": username,
                        "status": "logged_in",
                        "message": f"Sesi dimuat untuk {username}"
                    })
                else:
                    cl.login(username, password)
                    session_data = cl.get_settings()
                    set_kv_data(session_key, json.dumps(session_data))
                    results.append({
                        "username": username,
                        "status": "logged_in",
                        "message": f"Sesi baru disimpan untuk {username}"
                    })
            except Exception as e:
                logger.error(f"Gagal login untuk {username}: {str(e)}")
                results.append({
                    "username": username,
                    "status": "failed",
                    "message": f"Gagal login: {str(e)}"
                })
                continue

            # Ambil feed dan like 2 postingan
            try:
                feed = cl.get_timeline_feed()
                count = 0
                for post in feed.get("feed_items", []):
                    if count >= 2:
                        break
                    if "media_or_ad" not in post:
                        continue
                    media = post["media_or_ad"]
                    if media.get("product_type") != "feed" or not media.get("id"):
                        continue
                    media_id = media["id"]
                    media_code = media.get("code", "unknown")
                    logger.info(f"Memberikan like pada {media_code}")
                    cl.media_like(media_id)
                    results.append({
                        "username": username,
                        "status": "success",
                        "message": f"Berhasil like postingan: {media_code}"
                    })
                    count += 1
                    time.sleep(random.uniform(2, 5))
                results.append({
                    "username" : username,
                    "status": "completed",
                    "message": f"Selesai memberikan {count} like"
                })
            except Exception as e:
                logger.error(f"Gagal like untuk {username}: {str(e)}")
                results.append({
                    "username": username,
                    "status": "failed",
                    "message": f"Gagal like: {str(e)}"
                })

        return {
            "statusCode": HTTPStatus.OK,
            "body": json.dumps({
                "message": "Proses selesai",
                "results": results
            })
        }

    except Exception as e:
        logger.error(f"Error server: {str(e)}")
        return {
            "statusCode": HTTPStatus.INTERNAL_SERVER_ERROR,
            "body": json.dumps({"error": f"Error server: {str(e)}"})
        }
