const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs/promises');

const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 5000;
const app = express();
const SESSION_FILE = 'sessions.json';

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize sessions storage
async function initializeSessionStore() {
  try {
    await fs.access(SESSION_FILE);
  } catch {
    await fs.writeFile(SESSION_FILE, JSON.stringify({}));
  }
}

// Read sessions from file
async function readSessions() {
  try {
    const data = await fs.readFile(SESSION_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading sessions:', error);
    return {};
  }
}

// Write sessions to file
async function writeSessions(sessions) {
  try {
    await fs.writeFile(SESSION_FILE, JSON.stringify(sessions, null, 2));
  } catch (error) {
    console.error('Error writing sessions:', error);
  }
}

// Save sharing progress
async function saveProgress(sessionId, progress) {
  const sessions = await readSessions();
  sessions[sessionId] = {
    ...sessions[sessionId],
    ...progress,
    lastUpdated: new Date().toISOString()
  };
  await writeSessions(sessions);
}

// Parse cookie JSON to cookie string
function parseCookiesFromJSON(cookieArray) {
  return cookieArray
    .map(cookie => `${cookie.key}=${cookie.value}`)
    .join("; ");
}

// Fetch Facebook Token
async function getFacebookToken(cookie) {
  const headers = {
    "authority": "business.facebook.com",
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
    "accept-language": "en-US,en;q=0.9",
    "cache-control": "max-age=0",
    "cookie": cookie,
    "referer": "https://www.facebook.com/",
    "sec-ch-ua": '".Not/A)Brand";v="99", "Google Chrome";v="103", "Chromium";v="103"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Linux"',
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "same-origin",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
  };

  try {
    const response = await axios.get("https://business.facebook.com/content_management", { headers });
    const token = response.data.split("EAAG")[1].split('","')[0];
    return `${cookie}|EAAG${token}`;
  } catch (error) {
    console.error("Failed to retrieve token:", error.message);
    return null;
  }
}

// Check Cookie Validity
async function isCookieAlive(cookie) {
  const headers = {
    "authority": "business.facebook.com",
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
    "accept-language": "en-US,en;q=0.9",
    "cache-control": "max-age=0",
    "cookie": cookie,
    "referer": "https://www.facebook.com/",
    "sec-ch-ua": '".Not/A)Brand";v="99", "Google Chrome";v="103", "Chromium";v="103"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Linux"',
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "same-origin",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
  };

  try {
    const response = await axios.get("https://business.facebook.com/content_management", { headers });
    return response.status === 200;
  } catch (error) {
    console.error("Cookie validation failed:", error.message);
    return false;
  }
}

// Get Post ID
async function getPostId(postLink) {
  try {
    const response = await axios.post(
      "https://id.traodoisub.com/api.php",
      new URLSearchParams({ link: postLink })
    );
    return response.data.id || null;
  } catch (error) {
    console.error("Error getting post ID:", error.message);
    return null;
  }
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post("/submit", async (req, res) => {
  const { cookie, url, amount, interval } = req.body;
  const sessionId = Date.now().toString();

  if (!cookie || !url || !amount || !interval) {
    return res.status(400).json({ detail: "Missing required parameters." });
  }

  // Initialize session
  await saveProgress(sessionId, {
    status: 'started',
    totalShares: parseInt(amount),
    completedShares: 0,
    url,
    interval
  });

  let cookieString = "";
  if (Array.isArray(cookie)) {
  	cookieString = parseCookiesFromJSON(cookie);
  } else if (typeof cookie === "string") {
        const potentialJSON = JSON.parse(cookie);
	    if (Array.isArray(potentialJSON) && potentialJSON.every(c => c.key && c.value)) {
	        cookieString = parseCookiesFromJSON(potentialJSON);
	    } else {
	       cookieString = cookie;
	    }
  } else {
    return res.status(400).json({ error: "Invalid cookie format." });
  }

  res.json({ session_id: sessionId });

  // Start the sharing process in the background
  shareInBackground(sessionId, cookieString, url, parseInt(amount), parseFloat(interval));
});

async function shareInBackground(sessionId, cookieString, url, amount, interval) {
  try {
    const isAlive = await isCookieAlive(cookieString);
    if (!isAlive) {
      await saveProgress(sessionId, { status: 'failed', error: 'Invalid cookie' });
      return;
    }

    const facebookToken = await getFacebookToken(cookieString);
    if (!facebookToken) {
      await saveProgress(sessionId, { status: 'failed', error: 'Token retrieval failed' });
      return;
    }
    const [retrievedCookie, token] = facebookToken.split("|");

    const postId = await getPostId(url);
    if (!postId) {
      await saveProgress(sessionId, { status: 'failed', error: 'Invalid post ID' });
      return;
    }

    let successCount = 0;

    for (let i = 0; i < amount; i++) {
      await delay(interval * 1000);
      const success = await performShareWithRetries(retrievedCookie, token, postId);
      if (success) {
        successCount++;
        await saveProgress(sessionId, {
          status: 'in_progress',
          completedShares: successCount
        });
      }
    }

    await saveProgress(sessionId, {
      status: 'completed',
      completedShares: successCount
    });
  } catch (error) {
    await saveProgress(sessionId, {
      status: 'failed',
      error: error.message
    });
  }
}

app.get("/total-sessions", async (req, res) => {
  try {
    const sessions = await readSessions();
    const activeSessions = Object.entries(sessions)
      .filter(([_, session]) => session.status === 'in_progress' || session.status === 'started')
      .map(([id, session]) => ({
        id: id,
        session: id.slice(-4),
        url: session.url,
        count: session.completedShares,
        target: session.totalShares
      }));
    res.json(activeSessions);
  } catch (error) {
    res.status(500).json({ detail: "Error fetching sessions" });
  }
});

// Initialize session store and start server
initializeSessionStore().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}.`);
  });
});
