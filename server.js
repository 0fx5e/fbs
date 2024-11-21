const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const cors = require('cors');
const axios = require('axios');

const PORT = process.env.PORT || 1001;
const app = express();
app.use(cors());
app.use(bodyParser.json());

const activeSessions = new Map();

// Serve index.html from the same directory as the server file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/session/start', async (req, res) => {
    try {
        const { authData, postLink, amount, delay } = req.body;

        if (!authData || !postLink || !amount || !delay) {
            return res.status(400).json({ error: 'Missing required fields.' });
        }

        const sessionId = Date.now().toString();
        const newSession = {
            id: sessionId,
            authData,
            postLink,
            amount: parseInt(amount, 10),
            delay: parseInt(delay, 10),
            status: 'running',
            successRates: [],
            totalAttempts: 0,
            currentIndex: 0
        };

        activeSessions.set(sessionId, newSession);
        processSession(sessionId);
        res.json({ sessionId, message: 'Session started successfully' });
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/session/:sessionId/pause', (req, res) => {
    const { sessionId } = req.params;
    const session = activeSessions.get(sessionId);

    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    session.status = 'paused';
    res.json({ message: 'Session paused successfully' });
});

app.post('/api/session/:sessionId/resume', (req, res) => {
    const { sessionId } = req.params;
    const session = activeSessions.get(sessionId);

    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    session.status = 'running';
    processSession(sessionId);
    res.json({ message: 'Session resumed successfully' });
});

app.post('/api/session/:sessionId/stop', (req, res) => {
    const { sessionId } = req.params;
    const session = activeSessions.get(sessionId);

    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    session.status = 'stopped';
    res.json({ message: 'Session stopped successfully' });
});

app.get('/api/session/:sessionId/status', (req, res) => {
    const { sessionId } = req.params;
    const session = activeSessions.get(sessionId);

    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    res.json({
        status: session.status,
        successRates: session.successRates,
        totalAttempts: session.totalAttempts,
        currentIndex: session.currentIndex
    });
});

async function processSession(sessionId) {
    const session = activeSessions.get(sessionId);
    if (!session || session.status !== 'running') return;

    try {
        const postId = await getPostId(session.postLink);

        if (!postId) {
            session.status = 'error';
            console.error('Invalid post link for session:', sessionId);
            return;
        }

        while (session.currentIndex < session.amount && session.status === 'running') {
            try {
                const success = await sharePost(session.authData, postId);
                session.successRates.push(success ? 1 : 0);
            } catch (err) {
                console.error('Error sharing post:', err);
                session.successRates.push(0);
            }
            session.totalAttempts++;
            session.currentIndex++;

            if (session.currentIndex < session.amount) {
                await new Promise(resolve => setTimeout(resolve, session.delay * 1000));
            }
        }

        if (session.currentIndex >= session.amount) {
            session.status = 'completed';
        }
    } catch (error) {
        console.error('Error processing session:', error);
        session.status = 'error';
    }
}

// Helper: Get post ID from URL
async function getPostId(postLink) {
    try {
        const response = await axios.post('https://id.traodoisub.com/api.php', new URLSearchParams({ link: postLink }));
        return response.data.id || null;
    } catch (error) {
        console.error('Error getting post ID:', error);
        return null;
    }
}

// Helper: Share post
async function sharePost(authData, postId) {
    try {
        const response = await axios.post(
            `https://graph.facebook.com/me/feed?link=https://m.facebook.com/${postId}&published=0`,
            {},
            {
                headers: {
                    cookie: authData
                }
            }
        );
        return !!response.data.id;
    } catch (error) {
        console.error('Error sharing post:', error);
        return false;
    }
}

async function getUserCookie(email, password) {
  const url = 'https://m.facebook.com';
  const loginUrl = `${url}/login.php`;

  try {
    const session = axios.create({
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 4.1.2; GT-I8552 Build/JZO54K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/59.0.3071.125 Mobile Safari/537.36',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
        'accept-language': 'en_US',
        'cache-control': 'max-age=0'
      }
    });

    // Step 1: Get initial login page to retrieve cookies and hidden inputs
    const response = await session.get(url);
    const body = response.data;

    // Extract hidden input values for login form submission
    const lsd = body.match(/name="lsd" value="(.*?)"/)?.[1];
    const jazoest = body.match(/name="jazoest" value="(.*?)"/)?.[1];
    const m_ts = body.match(/name="m_ts" value="(.*?)"/)?.[1];
    const li = body.match(/name="li" value="(.*?)"/)?.[1];

    // Step 2: Prepare data payload with extracted hidden inputs
    const data = new URLSearchParams({
      lsd: lsd || '',
      jazoest: jazoest || '',
      m_ts: m_ts || '',
      li: li || '',
      email: email,
      pass: password,
      login: 'submit'
    });

    // Step 3: Submit login form
    const loginResponse = await session.post(loginUrl, data);

    // Retrieve the set-cookie header if login is successful
    const cookies = loginResponse.headers['set-cookie'];
    if (!cookies) return null;

    // Extract `datr`, `c_user`, `xs`, and other cookies
    const extractedCookies = {};
    cookies.forEach(cookie => {
      const [key, value] = cookie.split('; ')[0].split('=');
      extractedCookies[key] = value;
    });

    if (extractedCookies.datr && extractedCookies.sb && extractedCookies['m_pixel_ratio'] && extractedCookies.c_user && extractedCookies.fr && extractedCookies['x-referer'] && extractedCookies.vpd && extractedCookies.ps_l && extractedCookies.ps_n && extractedCookies.locale && extractedCookies.fbl_st && extractedCookies.wl_cbv) {
      return extractedCookies;
    }

    return null;
  } catch (error) {
    console.error('Error fetching user cookie:', error.message);
    return null;
  }
}

async function getFacebookToken(cookies) {
  const cookieString = Object.entries(cookies)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');

  const headers = {
    'authority': 'business.facebook.com',
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
    'cookie': cookieString,
    'referer': 'https://www.facebook.com/',
    'sec-ch-ua': '".Not/A)Brand";v="99", "Google Chrome";v="103", "Chromium";v="103"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Linux"',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'same-origin',
    'sec-fetch-user': '?1',
    'upgrade-insecure-requests': '1',
  };

  try {
    const response = await axios.get('https://business.facebook.com/content_management', { headers });
    const tokenMatch = response.data.match(/EAAG[\w\d]+/);
    if (tokenMatch) {
      return tokenMatch[0];
    } else {
      throw new Error('Token not found in response.');
    }
  } catch (error) {
    console.error('Error fetching token:', error.message);
    return null;
  }
}

app.get('/api/get/token', async (req, res) => {
  const { email, password } = req.query;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const cookies = await getUserCookie(email, password);

    if (!cookies) {
      return res.status(401).json({ error: 'Failed to retrieve user cookies' });
    }

    const token = await getFacebookToken(cookies);

    if (!token) {
      return res.status(401).json({ error: 'Failed to retrieve access token' });
    }

    return res.status(200).json({
      cookies: cookies,
      token: token
    });
  } catch (error) {
    console.error('Internal Server Error:', error.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
