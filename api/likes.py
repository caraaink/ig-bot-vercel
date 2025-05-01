import json
import time
import os
import random
import logging
from instagrapi import Client
from supabase import create_client, Client as SupabaseClient
from http import HTTPStatus

# Inisialisasi logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Inisialisasi Supabase client
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
supabase: SupabaseClient = create_client(SUPABASE_URL, SUPABASE_KEY)

def handler(request):
    try:
        # Ambil data akun dari tabel accounts
        logger.info("Mengambil data akun dari Supabase")
        response = supabase.table("accounts").select("*").execute()
        accounts = response.data[0]["data"]
        if not accounts:
            logger.error("Tidak ada akun yang ditemukan")
            return {
                "statusCode": HTTPStatus.BAD_REQUEST,
                "body": json.dumps({"error": "Tidak ada akun yang ditemukan"})
            }

        results = []

        # Proses setiap akun
        for account in accounts:
            username = account.get("username")
            password = account.get("password")
            logger.info(f"Memproses akun: {username}")
            if not username or not password:
                logger.error(f"Data akun tidak valid untuk {username or 'unknown'}")
                results.append({
                    "username": username or "unknown",
                    "status": "failed",
                    "message": "Data akun tidak valid"
                })
                continue

            # Inisialisasi client instagrapi
            cl = Client()

            # Cek sesi
            try:
                session_response = supabase.table("session").select("session_data").eq("username", username).execute()
                if session_response.data:
                    session_data = session_response.data[0]["session_data"]
                    cl.load_settings_dict(session_data)
                    cl.login(username, password)
                    results.append({
                        "username": username,
                        "status": "logged_in",
                        "message": f"Sesi dimuat untuk {username}"
                    })
                else:
                    cl.login(username, password)
                    session_data = cl.get_settings()
                    supabase.table("session").insert({
                        "username": username,
                        "session_data": session_data
                    }).execute()
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
                    "message": f"Gagal login atau memuat sesi untuk {username}: {str(e)}"
                })
                continue

            # Ambil feed
            try:
                feed = cl.get_timeline_feed()
            except Exception as e:
                logger.error(f"Gagal mengambil feed untuk {username}: {str(e)}")
                results.append({
                    "username": username,
                    "status": "failed",
                    "message": f"Gagal mengambil feed untuk {username}: {str(e)}"
                })
                continue

            # Like 2 postingan
            count = 0
            try:
                for post in feed['feed_items']:
                    if count < 2:
                        if 'media_or_ad' in post:
                            media = post['media_or_ad']
                            if 'id' in media and 'code' in media and media.get('product_type') == 'feed':
                                media_id = media['id']
                                media_code = media['code']
                                logger.info(f"Memberikan like pada {media_code}")
                                cl.media_like(media_id)
                                results.append({
                                    "username": username,
                                    "status": "success",
                                    "message": f"Berhasil like postingan: {media_id} ({media_code})"
                                })
                                count += 1
                                time.sleep(random.uniform(2, 5))
                            else:
                                continue
                        else:
                            continue
                    else:
                        break
                logger.info(f"Selesai memberikan {count} like untuk {username}")
                results.append({
                    "username": username,
                    "status": "completed",
                    "message": f"Selesai memberikan {count} like untuk {username}"
                })
            except Exception as e:
                logger.error(f"Error saat memberikan like untuk {username}: {str(e)}")
                results.append({
                    "username": username,
                    "status": "failed",
                    "message": f"Error saat memberikan like untuk {username}: {str(e)}"
                })

        logger.info("Semua akun telah diproses")
        return {
            "statusCode": HTTPStatus.OK,
            "body": json.dumps({
                "message": "Semua akun telah diproses",
                "results": results
            })
        }

    except Exception as e:
        logger.error(f"Error server: {str(e)}")
        return {
            "statusCode": HTTPStatus.INTERNAL_SERVER_ERROR,
            "body": json.dumps({"error": f"Error server: {str(e)}"})
        }
