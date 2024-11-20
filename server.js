const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const cors = require('cors');
const axios = require('axios');

const PORT = process.env.PORT || 1001;
const app = express();
app.use(cors());
app.use(bodyParser.json());

// In-memory storage for active sessions
const activeSessions = new Map();

// Serve index.html from the same directory as the server file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/session/start', async (req, res) => {
    try {
        const { authData, postLink, amount, delay } = req.body;

        // Input validation
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

        // Start the session processing
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

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
