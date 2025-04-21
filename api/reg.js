const express = require('express');
const { IgApiClient, IgCheckpointError } = require('instagram-private-api');
const path = require('path');

const app = express();
app.use(express.json());

// Serve file statis dari folder public
app.use(express.static(path.join(__dirname, '../public')));

// Konfigurasi
const config = {
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

// Fungsi untuk generate string acak (hanya huruf dan angka)
function generateRandomString(length) {
  const characters = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

// Fungsi untuk generate data pendaftaran
function generateRegistrationData(email) {
  const username = `user_${generateRandomString(8)}`;
  const password = `${generateRandomString(8)}123`; // Pastikan ada huruf dan angka
  const firstName = `User${generateRandomString(4)}`;
  const birthday = {
    day: Math.floor(Math.random() * 28) + 1,
    month: Math.floor(Math.random() * 12) + 1,
    year: 1995 + Math.floor(Math.random() * 10), // Tahun antara 1995-2004
  };
  return {
    email,
    username,
    password,
    first_name: firstName,
    birthday,
  };
}

async function registerAccount(email) {
  try {
    // Generate data pendaftaran
    const regData = generateRegistrationData(email);
    ig.state.generateDevice(regData.username);

    // Log data pendaftaran untuk debugging
    console.log(`${new Date().toISOString()} [DEBUG] Registration data: ${JSON.stringify(regData)}`);

    // Delay sebelum mendaftar untuk simulasi perilaku manusia
    await new Promise(resolve => setTimeout(resolve, 2000)); // 2 detik

    // Daftar akun baru
    const response = await ig.account.create({
      email: regData.email,
      username: regData.username,
      password: regData.password,
      first_name: regData.first_name,
      day: regData.birthday.day,
      month: regData.birthday.month,
      year: regData.birthday.year,
    });

    if (response.account_created) {
      const accountData = {
        email: regData.email,
        username: regData.username,
        password: regData.password,
        first_name: regData.first_name,
        created_at: new Date().toISOString(),
      };
      console.log(`${new Date().toISOString()} [REGISTER_SUCCESS] ${regData.username} (${regData.email})`);
      return { status: 'success', data: accountData };
    } else {
      throw new Error(`Account creation failed: ${JSON.stringify(response)}`);
    }
  } catch (error) {
    if (error instanceof IgCheckpointError) {
      const challengeUrl = ig.state.checkpoint.url;
      console.log(`${new Date().toISOString()} [REGISTER_CHALLENGE] Challenge required at ${challengeUrl}`);
      return { status: 'challenge', message: `Challenge required at ${challengeUrl}. Please verify manually.` };
    }
    console.log(`${new Date().toISOString()} [REGISTER_ERROR] ${error.message}`);
    return { status: 'fail', message: error.message };
  }
}

// Endpoint untuk mendaftar akun
app.post('/register', async (req, res) => {
  const { email } = req.body;

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  try {
    const result = await registerAccount(email);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = app;
