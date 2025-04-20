const express = require('express');
const { IgApiClient, IgCheckpointError } = require('instagram-private-api');
const Redis = require('ioredis');

const app = express();
app.use(express.json());

// Validasi environment variables
const requiredEnvVars = ['REDIS_URL', 'IG_USERNAME', 'IG_PASSWORD'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Missing environment variable: ${envVar}`);
    process.exit(1);
  }
}

// Konfigurasi
const config = {
  username: process.env.IG_USERNAME,
  password: process.env.IG_PASSWORD,
  likeBerandaAktif: true,
  // Fake location (Jakarta, Indonesia)
  fakeLocation: {
    latitude: -6.2088,
    longitude: 106.8456,
  },
  // Fake device (Modern Samsung device, Instagram 334.0.0.42.95 Android)
  device: {
    userAgent: 'Instagram 334.0.0.42.95 Android (33/13; 480dpi; 1080x2400; Samsung; SM-G998B; z3q; exynos2100; en_US)',
    deviceString: 'Samsung-SM-G998B-z3q',
    androidVersion: 33,
    androidRelease: '13',
    dpi: '480dpi',
    resolution: '1080x2400',
    manufacturer: 'Samsung',
    model: 'SM-G998B',
    cpu: 'exynos2100',
    language: 'en_US',
  },
};

// Inisialisasi Redis
let redis;
try {
  redis = new Redis(process.env.REDIS_URL);
  redis.on('error', (err) => console.error('Redis Client Error:', err));
} catch (error) {
  console.error('Failed to initialize Redis:', error.message);
  process.exit(1);
}

// Inisialisasi Instagram client
const ig = new IgApiClient();

// Set fake device dan user agent
ig.state.deviceString = config.device.deviceString;
ig.state.deviceId = `android-${Math.random().toString(36).substring(2, 18)}`;
ig.state.androidVersion = config.device.androidVersion;
ig.state.androidRelease = config.device.androidRelease;
ig.state.dpi = config.device.dpi;
ig.state.resolution = config.device.resolution;
ig.state.manufacturer = config.device.manufacturer;
ig.state.model = config.device.model;
ig.state.cpu = config.device.cpu;
ig.state.language = config.device.language;

// Set user agent untuk semua request
ig.request.customUserAgent = () => config.device.userAgent;

// Set fake location untuk semua request
ig.request.customRequestInterceptor = (options) => {
  options.headers['X-IG-Device-Location'] = JSON.stringify({
    lat: config.fakeLocation.latitude,
    lng: config.fakeLocation.longitude,
  });
  return options;
};

async function handleChallenge() {
  try {
    const challengeUrl = ig.state.checkpoint.url;
    await redis.append('igerror.log', `${new Date().toISOString()} [CHALLENGE] Challenge required at ${challengeUrl}\n`);

    const { body } = await ig.challenge.selectVerifyMethod(0); // 0 untuk email, 1 untuk SMS
    if (body.step_name === 'verify_email' || body.step_name === 'verify_sms') {
      await redis.append('igerror.log', `${new Date().toISOString()} [CHALLENGE] Verification code sent to ${body.step_data.contact_point}\n`);
      return { status: 'challenge', message: `Verification code sent to ${body.step_data.contact_point}. Please check and provide the code.` };
    }
    return { status: 'fail', message: 'Unable to handle challenge automatically. Please verify manually.' };
  } catch (error) {
    await redis.append('igerror.log', `${new Date().toISOString()} [CHALLENGE_ERROR] ${error.message}\n`);
    return { status: 'fail', message: error.message };
  }
}

async function initialize() {
  ig.state.generateDevice(config.username);

  // Cek apakah sudah login
  try {
    const cookies = await redis.get(`${config.username}-cookies`);
    const userId = await redis.get(`${config.username}-userId`);
    const token = await redis.get(`${config.username}-token`);

    if (cookies && userId && token) {
      ig.state.session = JSON.parse(cookies);
      ig.state.userId = userId;
      ig.state.csrfToken = token;
      return { status: 'ok', userId };
    }

    // Login jika belum
    try {
      // Delay sebelum login untuk simulasi perilaku manusia
      await new Promise(resolve => setTimeout(resolve, 2000)); // 2 detik
      await ig.account.login(config.username, config.password);
      const serializedSession = JSON.stringify(ig.state.session);
      await redis.set(`${config.username}-cookies`, serializedSession);
      await redis.set(`${config.username}-userId`, ig.state.userId);
      await redis.set(`${config.username}-token`, ig.state.csrfToken);
      return { status: 'ok', userId: ig.state.userId };
    } catch (error) {
      if (error instanceof IgCheckpointError) {
        return await handleChallenge();
      }
      await redis.append('igerror.log', `${new Date().toISOString()} [LOGIN_ERROR] ${error.message}\n`);
      return { status: 'fail', message: error.message };
    }
  } catch (error) {
    await redis.append('igerror.log', `${new Date().toISOString()} [LOGIN_ERROR] ${error.message}\n`);
    return { status: 'fail', message: error.message };
  }
}

async function likeTimeline() {
  if (!config.likeBerandaAktif) return { status: 'ok', message: 'Like beranda tidak aktif' };

  const userId = ig.state.userId;
  const logKey = `${userId}_likesTimeline`;

  try {
    const feed = ig.feed.timeline();
    const items = await feed.items();
    const results = [];

    // Batasi jumlah item untuk simulasi perilaku manusia
    const limitedItems = items.slice(0, 3); // Proses hanya 3 item
    for (const item of limitedItems) {
      // Log struktur data item untuk debugging
      await redis.append('igerror.log', `${new Date().toISOString()} [DEBUG] Media data: ${JSON.stringify(item)}\n`);

      // Validasi data media sebelum like
      if (!item || typeof item !== 'object' || !item.id) {
        results.push(`[SKIP] [INVALID_MEDIA] => ${item?.id || 'unknown'}`);
        await redis.append('igerror.log', `${new Date().toISOString()} [SKIP] Invalid media data (missing id): ${JSON.stringify(item)}\n`);
        continue;
      }

      // Gunakan nilai default untuk has_liked dan is_ad jika tidak ada
      const hasLiked = item.has_liked ?? false;
      const isAd = item.is_ad ?? false;

      if (!hasLiked && !isAd && item.id) {
        const mediaId = item.id;
        const likedMedia = await redis.smembers(logKey);
        if (!likedMedia.includes(mediaId)) {
          try {
            await ig.media.like({ mediaId });
            await redis.sadd(logKey, mediaId);
            results.push(`[SUCCESS] [LIKE_MEDIA] => ${mediaId}`);
            await redis.append('igerror.log', `${new Date().toISOString()} [LIKE_MEDIA] => ${mediaId} (SUCCESS)\n`);
            await new Promise(resolve => setTimeout(resolve, 500)); // Delay 0.5 detik per like
          } catch (error) {
            results.push(`[ERROR] [LIKE_MEDIA] => ${mediaId} (${error.message})`);
            await redis.append('igerror.log', `${new Date().toISOString()} [LIKE_MEDIA] => ${mediaId} (ERROR: ${error.message})\n`);
          }
        } else {
          results.push(`[SKIP] [ALREADY_LIKED] => ${mediaId}`);
        }
      } else {
        results.push(`[SKIP] [NOT_LIKEABLE] => ${item.id} (has_liked: ${hasLiked}, is_ad: ${isAd})`);
        await redis.append('igerror.log', `${new Date().toISOString()} [SKIP] Not likeable: ${item.id} (has_liked: ${hasLiked}, is_ad: ${isAd})\n`);
      }
    }
    return { status: 'ok', results };
  } catch (error) {
    if (error.message.includes('login_required')) {
      await redis.del(`${config.username}-cookies`, `${config.username}-userId`, `${config.username}-token`);
    }
    await redis.append('igerror.log', `${new Date().toISOString()} [TIMELINE_ERROR] ${error.message}\n`);
    return { status: 'fail', message: error.message };
  }
}

// Endpoint untuk testing
app.get('/', async (req, res) => {
  res.send('Instagram Bot is running. Use /likes to trigger the bot.');
});

// Endpoint untuk cron manual
app.get('/likes', async (req, res) => {
  try {
    const login = await initialize();
    if (login.status === 'fail') {
      return res.status(500).json({ error: login.message });
    }
    if (login.status === 'challenge') {
      return res.status(403).json({ error: login.message });
    }
    const result = await likeTimeline();
    if (result.status === 'fail') {
      return res.status(500).json({ error: result.message });
    }
    res.json({ status: 'success', results: result.results || ['No new media to like'] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = app;
