from fastapi import FastAPI, HTTPException
from instagrapi import Client
from instagrapi.exceptions import ClientError, LoginRequired
import redis
import os
import time

app = FastAPI()

# Validasi environment variables
required_env_vars = ["REDIS_URL", "IG_USERNAME", "IG_PASSWORD"]
for var in required_env_vars:
    if not os.getenv(var):
        raise EnvironmentError(f"Missing environment variable: {var}")

# Konfigurasi
config = {
    "username": os.getenv("IG_USERNAME"),
    "password": os.getenv("IG_PASSWORD"),
    "like_beranda_aktif": True,
    # Fake location (Jakarta, Indonesia)
    "fake_location": {
        "latitude": -6.2088,
        "longitude": 106.8456,
    },
    # Fake device (modern Samsung device, Instagram 334.0.0.42.95 Android)
    "settings": {
        "user_agent": "Instagram 334.0.0.42.95 Android (33/13; 480dpi; 1080x2400; Samsung; SM-G998B; z3q; exynos2100; en_US)",
        "device_settings": {
            "android_version": 33,
            "android_release": "13",
            "dpi": "480dpi",
            "resolution": "1080x2400",
            "manufacturer": "Samsung",
            "model": "SM-G998B",
            "cpu": "exynos2100",
            "language": "en_US",
        },
    },
}

# Inisialisasi Redis
try:
    r = redis.Redis.from_url(os.getenv("REDIS_URL"), decode_responses=True)
except Exception as e:
    raise Exception(f"Failed to initialize Redis: {str(e)}")

# Inisialisasi Instagram client
cl = Client()

# Set user agent dan device settings
cl.set_user_agent(config["settings"]["user_agent"])
cl.set_device(config["settings"]["device_settings"])

# Set fake location
cl.set_position(latitude=config["fake_location"]["latitude"], longitude=config["fake_location"]["longitude"])

async def initialize():
    try:
        # Cek apakah sudah login
        session = r.get(f"{config['username']}-session")
        user_id = r.get(f"{config['username']}-userId")

        if session and user_id:
            cl.load_settings(session)
            cl.user_id = user_id
            return {"status": "ok", "user_id": user_id}

        # Login jika belum
        time.sleep(2)  # Delay 2 detik untuk simulasi perilaku manusia
        cl.login(config["username"], config["password"])
        r.set(f"{config['username']}-session", cl.get_settings())
        r.set(f"{config['username']}-userId", cl.user_id)
        return {"status": "ok", "user_id": cl.user_id}
    except ClientError as e:
        if "challenge_required" in str(e).lower():
            r.append("igerror.log", f"{time.ctime()} [CHALLENGE] Challenge required: {str(e)}\n")
            return {"status": "challenge", "message": "Challenge required. Please verify manually."}
        r.append("igerror.log", f"{time.ctime()} [LOGIN_ERROR] {str(e)}\n")
        return {"status": "fail", "message": str(e)}
    except Exception as e:
        r.append("igerror.log", f"{time.ctime()} [LOGIN_ERROR] {str(e)}\n")
        return {"status": "fail", "message": str(e)}

async def like_timeline():
    if not config["like_beranda_aktif"]:
        return {"status": "ok", "message": "Like beranda tidak aktif"}

    user_id = cl.user_id
    log_key = f"{user_id}_likesTimeline"

    try:
        # Ambil timeline (media dari user yang di-follow)
        medias = cl.timeline_feed(amount=3).get("media", [])
        results = []

        for media in medias[:3]:  # Batasi 3 item
            # Log struktur data media untuk debugging
            r.append("igerror.log", f"{time.ctime()} [DEBUG] Media data: {media}\n")

            # Validasi media
            if not media or not hasattr(media, "id"):
                results.append(f"[SKIP] [INVALID_MEDIA] => {getattr(media, 'id', 'unknown')}")
                r.append("igerror.log", f"{time.ctime()} [SKIP] Invalid media data (missing id): {media}\n")
                continue

            has_liked = media.liked if hasattr(media, "liked") else False
            is_ad = media.is_ad if hasattr(media, "is_ad") else False

            if not has_liked and not is_ad and media.id:
                media_id = media.id
                if not r.sismember(log_key, media_id):
                    try:
                        cl.media_like(media_id)
                        r.sadd(log_key, media_id)
                        results.append(f"[SUCCESS] [LIKE_MEDIA] => {media_id}")
                        r.append("igerror.log", f"{time.ctime()} [LIKE_MEDIA] => {media_id} (SUCCESS)\n")
                        time.sleep(0.5)  # Delay 0.5 detik per like
                    except Exception as e:
                        results.append(f"[ERROR] [LIKE_MEDIA] => {media_id} ({str(e)})")
                        r.append("igerror.log", f"{time.ctime()} [LIKE_MEDIA] => {media_id} (ERROR: {str(e)})\n")
                else:
                    results.append(f"[SKIP] [ALREADY_LIKED] => {media_id}")
            else:
                results.append(f"[SKIP] [NOT_LIKEABLE] => {media.id} (has_liked: {has_liked}, is_ad: {is_ad})")
                r.append("igerror.log", f"{time.ctime()} [SKIP] Not likeable: {media.id} (has_liked: {has_liked}, is_ad: {is_ad})\n")

        return {"status": "ok", "results": results}
    except LoginRequired:
        r.delete(f"{config['username']}-session", f"{config['username']}-userId")
        r.append("igerror.log", f"{time.ctime()} [TIMELINE_ERROR] Login required\n")
        return {"status": "fail", "message": "Login required"}
    except Exception as e:
        r.append("igerror.log", f"{time.ctime()} [TIMELINE_ERROR] {str(e)}\n")
        return {"status": "fail", "message": str(e)}

@app.get("/")
async def root():
    return {"message": "Instagram Bot is running. Use /likes to trigger the bot."}

@app.get("/likes")
async def likes():
    try:
        login = await initialize()
        if login["status"] == "fail":
            raise HTTPException(status_code=500, detail=login["message"])
        if login["status"] == "challenge":
            raise HTTPException(status_code=403, detail=login["message"])
        result = await like_timeline()
        if result["status"] == "fail":
            raise HTTPException(status_code=500, detail=result["message"])
        return {"status": "success", "results": result.get("results", ["No new media to like"])}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
