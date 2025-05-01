import json
import time
import requests
from instagrapi import Client
from http import HTTPStatus

def handler(request):
    try:
        # Fetch account data from Uptaste API
        api_url = "https://ig-bot-tau.vercel.app/likes"
        response = requests.get(api_url)
        if response.status_code != 200:
            return {
                "statusCode": HTTPStatus.INTERNAL_SERVER_ERROR,
                "body": json.dumps({"error": "Failed to fetch accounts from API"})
            }

        # Parse account data
        accounts = response.json()
        if not accounts:
            return {
                "statusCode": HTTPStatus.BAD_REQUEST,
                "body": json.dumps({"error": "No accounts found in API response"})
            }

        results = []

        # Process each account
        for account in accounts:
            username = account.get("username")
            password = account.get("password")
            if not username or not password:
                results.append({
                    "username": username or "unknown",
                    "status": "failed",
                    "message": "Invalid account data"
                })
                continue

            # Initialize instagrapi client
            cl = Client()

            # Try to load session from Uptaste
            session_url = f"https://ig-bot-tau.vercel.app/sessions/session_{username}.json"
            try:
                session_response = requests.get(session_url)
                if session_response.status_code == 200:
                    session_data = session_response.json()
                    cl.load_settings_dict(session_data)
                    cl.login(username, password)  # Verify session
                    results.append({
                        "username": username,
                        "status": "logged_in",
                        "message": f"Loaded session for {username}"
                    })
                else:
                    # No session found, perform fresh login
                    cl.login(username, password)
                    # Save session to Uptaste
                    session_data = cl.get_settings()
                    save_session_url = "https://ig-bot-tau.vercel.app/sessions"
                    requests.post(save_session_url, json={
                        "username": username,
                        "session": session_data
                    })
                    results.append({
                        "username": username,
                        "status": "logged_in",
                        "message": f"Created and saved new session for {username}"
                    })
            except Exception as e:
                results.append({
                    "username": username,
                    "status": "failed",
                    "message": f"Failed to login or load session for {username}: {str(e)}"
                })
                continue

            # Fetch timeline feed
            try:
                feed = cl.get_timeline_feed()
            except Exception as e:
                results.append({
                    "username": username,
                    "status": "failed",
                    "message": f"Failed to fetch feed for {username}: {str(e)}"
                })
                continue

            # Like up to 2 posts
            count = 0
            try:
                for post in feed['feed_items']:
                    if count < 2:
                        if 'media_or_ad' in post:
                            media = post['media_or_ad']
                            if 'id' in media and 'code' in media and media.get('product_type') == 'feed':
                                media_id = media['id']
                                media_code = media['code']
                                cl.media_like(media_id)
                                results.append({
                                    "username": username,
                                    "status": "success",
                                    "message": f"Liked post: {media_id} ({media_code})"
                                })
                                count += 1
                                time.sleep(0.5)  # 500ms delay
                            else:
                                continue
                        else:
                            continue
                    else:
                        break
                results.append({
                    "username": username,
                    "status": "completed",
                    "message": f"Finished liking {count} posts for {username}"
                })
            except Exception as e:
                results.append({
                    "username": username,
                    "status": "failed",
                    "message": f"Error liking posts for {username}: {str(e)}"
                })

        return {
            "statusCode": HTTPStatus.OK,
            "body": json.dumps({
                "message": "All accounts processed",
                "results": results
            })
        }

    except Exception as e:
        return {
            "statusCode": HTTPStatus.INTERNAL_SERVER_ERROR,
            "body": json.dumps({"error": f"Server error: {str(e)}"})
        }
