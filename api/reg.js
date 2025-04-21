const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
app.use(express.json());

// Serve file statis dari folder public
app.use(express.static(path.join(__dirname, '../public')));

// Konfigurasi
const config = {
  device: {
    userAgent: 'Instagram 200.0.0.18.114 Android (30/11; 480dpi; 1080x2400; Samsung; SM-G998B; z3q; exynos2100; en_US)',
    deviceString: 'Samsung-SM-G998B-z3q',
    androidVersion: 30,
    androidRelease: '11',
    dpi: '480dpi',
    resolution: '1080x2400',
    manufacturer: 'Samsung',
    model: 'SM-G998B',
    cpu: 'exynos2100',
    language: 'en_US',
  },
};

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

// Fungsi untuk mengambil CSRF token
async function getCsrfToken() {
  try {
    const response = await fetch('https://i.instagram.com/api/v1/accounts/login/', {
      method: 'GET',
      headers: {
        'User-Agent': config.device.userAgent,
        'X-IG-App-ID': '936619743392459',
        'X-IG-Connection-Type': 'WIFI',
        'X-IG-Capabilities': '3brTvw==',
        'Accept-Language': 'en-US',
      },
    });

    const cookies = response.headers.get('set-cookie');
    console.log(`${new Date().toISOString()} [DEBUG] Cookies: ${cookies}`);

    const csrfToken = cookies?.match(/csrftoken=([^;]+)/)?.[1];
    if (!csrfToken) {
      throw new Error('Failed to extract CSRF token');
    }
    return csrfToken;
  } catch (error) {
    console.log(`${new Date().toISOString()} [CSRF_ERROR] ${error.message}`);
    throw error;
  }
}

async function registerAccount(email) {
  try {
    // Ambil CSRF token terlebih dahulu
    const csrfToken = await getCsrfToken();

    // Generate data pendaftaran
    const regData = generateRegistrationData(email);

    // Log data pendaftaran untuk debugging
    console.log(`${new Date().toISOString()} [DEBUG] Registration data: ${JSON.stringify(regData)}`);

    // Delay sebelum mendaftar untuk simulasi perilaku manusia
    await new Promise(resolve => setTimeout(resolve, 2000)); // 2 detik

    // Kirim request manual ke Instagram API
    const deviceId = `android-${Math.random().toString(36).substring(2, 18)}`;
    const response = await fetch('https://i.instagram.com/api/v1/accounts/create/', {
      method: 'POST',
      headers: {
        'User-Agent': config.device.userAgent,
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-IG-App-ID': '936619743392459',
        'X-IG-Connection-Type': 'WIFI',
        'X-IG-Capabilities': '3brTvw==',
        'X-IG-App-Locale': 'en_US',
        'X-IG-Device-Locale': 'en_US',
        'X-IG-Mapped-Locale': 'en_US',
        'Accept-Language': 'en-US',
        'X-CSRFToken': csrfToken,
      },
      body: new URLSearchParams({
        email: regData.email,
        username: regData.username,
        password: regData.password,
        first_name: regData.first_name,
        day: regData.birthday.day.toString(),
        month: regData.birthday.month.toString(),
        year: regData.birthday.year.toString(),
        device_id: deviceId,
        _csrftoken: csrfToken,
      }).toString(),
    });

    // Log status dan header response
    console.log(`${new Date().toISOString()} [DEBUG] Response status: ${response.status}`);
    console.log(`${new Date().toISOString()} [DEBUG] Response headers: ${JSON.stringify([...response.headers])}`);

    // Coba parse response sebagai JSON, jika gagal tangani sebagai teks
    let result;
    const responseText = await response.text();
    console.log(`${new Date().toISOString()} [DEBUG] Raw response: ${responseText}`);

    try {
      result = JSON.parse(responseText);
    } catch (e) {
      throw new Error(`Invalid response format: ${responseText}`);
    }

    if (result.account_created) {
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
      throw new Error(`Account creation failed: ${JSON.stringify(result)}`);
    }
  } catch (error) {
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
