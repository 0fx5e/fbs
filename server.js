const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const cors = require('cors');
const axios = require('axios');

const PORT = process.env.PORT || 1001;
const app = express();
app.use(cors());
app.use(bodyParser.json());

// Serve the index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Utility function to unify cookie formats
function formatCookie(cookie) {
    if (typeof cookie === 'string') {
        // Convert string format to array of { key, value }
        return cookie.split(';').map(cookieStr => {
            const [key, value] = cookieStr.trim().split('=');
            return { key, value };
        });
    }
    // Ensure the array format is valid
    if (Array.isArray(cookie) && cookie.every(c => c.key && c.value)) {
        return cookie;
    }
    return null; // Return null for invalid formats
}

// Utility function to construct the Cookie header
function buildCookieHeader(cookieArray) {
    return cookieArray.map(c => `${c.key}=${c.value}`).join('; ');
}

// POST API to handle submission
app.post('/api/submit', async (req, res) => {
    try {
        let { cookie, postLink, amount, interval } = req.body;

        // Validate required fields
        if (!cookie || !postLink || !amount || !interval) {
            return res.status(400).json({ error: 'Missing required fields.' });
        }

        // Format the cookie into a unified array format
        cookie = formatCookie(cookie);
        if (!cookie) {
            return res.status(400).json({ error: 'Invalid cookie format.' });
        }

        // Check if the cookie is alive
        const cookieAlive = await isCookieAlive(cookie);
        if (!cookieAlive) {
            return res.status(401).json({ error: 'Cookie is invalid or expired.' });
        }

        // Get the post ID from the link
        const postId = await getPostId(postLink);
        if (!postId) {
            return res.status(400).json({ error: 'Invalid post link.' });
        }

        // Attempt to share the post
        const response = await sharePost(cookie, postId);
        if (response) {
            return res.json({ successRates: [true] });
        } else {
            return res.status(500).json({ error: 'Failed to share the post.' });
        }
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// Helper: Get post ID from URL
async function getPostId(postLink) {
    try {
        const response = await axios.post(
            'https://id.traodoisub.com/api.php',
            new URLSearchParams({ link: postLink })
        );
        return response.data.id || null;
    } catch (error) {
        console.error('Error getting post ID:', error);
        return null;
    }
}

// Helper: Share post using cookies
async function sharePost(cookie, postId) {
    try {
        const cookieHeader = buildCookieHeader(cookie);

        const response = await axios.post(
            `https://graph.facebook.com/me/feed?link=https://m.facebook.com/${postId}&published=0`,
            {},
            {
                headers: {
                    Cookie: cookieHeader,
                },
            }
        );

        return !!response.data.id;
    } catch (error) {
        console.error('Error sharing post:', error);
        return false;
    }
}

// Helper: Check if cookie is alive
async function isCookieAlive(cookie) {
    const cookieHeader = buildCookieHeader(cookie);

    const headers = {
        authority: 'business.facebook.com',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
        'accept-language': 'vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5',
        'cache-control': 'max-age=0',
        cookie: cookieHeader,
        referer: 'https://www.facebook.com/',
        'sec-ch-ua': '".Not/A)Brand";v="99", "Google Chrome";v="103", "Chromium";v="103"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Linux"',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-user': '?1',
        'upgrade-insecure-requests': '1',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.5060.134 Safari/537.36',
    };

    try {
        const response = await axios.get('https://business.facebook.com/content_management', { headers });
        return response.status === 200;
    } catch (error) {
        console.error('Error checking if cookie is alive:', error);
        return false;
    }
}

// Start the server
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
