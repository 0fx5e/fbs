const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const cors = require("cors");
const axios = require("axios");

const PORT = process.env.PORT || 1001;
const app = express();
app.use(cors());
app.use(bodyParser.json());

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

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

// Perform Share with Retries
async function performShareWithRetries(cookie, token, postId, retries = 3) {
  const headers = {
    accept: "*/*",
    cookie,
    host: "graph.facebook.com",
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
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
      }
    } catch (error) {
      console.error(`Share attempt ${attempt} failed: ${error.message}`);
      if (attempt === retries) return false; // Fail after max retries
    }
  }
}

// Delay Utility
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.post("/api/submit", async (req, res) => {
  const { cookie, url, amount, interval } = req.body;

  if (!cookie || !url || !amount || !interval) {
    return res.status(400).json({ error: "Missing required parameters." });
  }

  // Normalize cookies input
  let cookieString = "";

  if (Array.isArray(cookie)) {
    // Convert appstate/cookie JSON to a string
    cookieString = parseCookiesFromJSON(cookie);
  } else if (typeof cookie === "string") {
    // Use cookie string as is
    cookieString = cookie;
  } else {
    return res.status(400).json({ error: "Invalid cookie format." });
  }

  // Validate Cookie
  const isAlive = await isCookieAlive(cookieString);
  if (!isAlive) {
    return res.status(401).json({ error: "Invalid or expired cookie." });
  }

  // Get Facebook Token
  const facebookToken = await getFacebookToken(cookieString);
  if (!facebookToken) {
    return res.status(500).json({ error: "Failed to retrieve access token." });
  }
  const [retrievedCookie, token] = facebookToken.split("|");

  // Get Post ID
  const postId = await getPostId(url);
  if (!postId) {
    return res.status(400).json({ error: "Failed to retrieve post ID." });
  }

  let successCount = 0;

  // Use concurrency with interval control
  const tasks = Array.from({ length: amount }).map(async (_, i) => {
    await delay(i * interval * 1000); // Control interval for each task
    const success = await performShareWithRetries(retrievedCookie, token, postId);
    if (success) successCount++;
  });

  // Wait for all tasks to complete
  await Promise.all(tasks);

  res.json({
    message: "Sharing process completed.",
    totalShares: amount,
    successfulShares: successCount,
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
