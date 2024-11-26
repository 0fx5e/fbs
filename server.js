const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const cors = require('cors');
const axios = require('axios');

const PORT = process.env.PORT || 1001;
const app = express();
app.use(cors());
app.use(bodyParser.json());

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

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
    const response = await axios.get(
      "https://business.facebook.com/content_management",
      { headers }
    );
    const token = response.data.split("EAAG")[1].split('","')[0];
    return `${cookie}|EAAG${token}`;
  } catch (error) {
    console.error("Failed to retrieve token:", error.message);
    return null;
  }
}

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
    const response = await axios.get(
      "https://business.facebook.com/content_management",
      { headers }
    );
    return response.status === 200;
  } catch (error) {
    console.error("Cookie validation failed:", error.message);
    return false;
  }
}

async function getPostId(postLink) {
    try {
        const response = await axios.post('https://id.traodoisub.com/api.php', new URLSearchParams({ link: postLink }));
        return response.data.id || null;
    } catch (error) {
        console.error('Error getting post ID:', error);
        return null;
    }
}

async function performShare(cookie, token, postId) {
  const headers = {
    accept: "*/*",
    "accept-encoding": "gzip, deflate",
    connection: "keep-alive",
    "content-length": "0",
    cookie: cookie,
    host: "graph.facebook.com",
  };

  try {
    const response = await axios.post(
      `https://graph.facebook.com/me/feed`,
      null,
      {
        headers,
        params: {
          link: `https://m.facebook.com/${postId}`,
          published: 0,
          access_token: token,
        },
      }
    );

    if (response.data.id) {
      console.log(`Share successful for post ID ${postId}`);
      return true;
    } else {
      console.error(`Error during sharing. Response:`, response.data);
      return false;
    }
  } catch (error) {
    console.error("Error during share:", error.message);
    return false;
  }
}

app.post("/api/check", async (req, res) => {
  const { cookie } = req.body;
  const isAlive = await isCookieAlive(cookie);
  if (!isAlive) {
    return res.status(401).json({ error: "Invalid or expired cookie." });
  }
  res.status(200).json({ status: "ok" });
});

app.post("/api/submit", async (req, res) => {
  const { cookie, postLink } = req.body;

  if (!cookie || !postLink) {
    return res.status(400).json({ error: "Missing required parameters." });
  }

  const facebookToken = await getFacebookToken(cookie);
  if (!facebookToken) {
    return res.status(500).json({ error: "Failed to retrieve access token." });
  }

  const [retrievedCookie, token] = facebookToken.split("|");

  const postId = await getPostId(postLink);
  if (!postId) {
    return res.status(400).json({ error: "Invalid post link." });
  }

  const success = await performShare(retrievedCookie, token, postId);
  if (success) {
    return res.status(200).json({ message: "Share successful" });
  } else {
    return res.status(500).json({ error: "Failed to share the post." });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
