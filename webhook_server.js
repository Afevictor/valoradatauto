const express = require('express');
const { runAutomation } = require('./dat_automation');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Main triggering endpoint
app.post('/webhook/trigger', async (req, res) => {
    console.log('📬 Webhook received from n8n');

    // We run this in the background (no await) so n8n doesn't timeout
    // if the automation takes several minutes.
    runAutomation()
        .then(() => console.log('🏁 Automation cycle finished.'))
        .catch(err => console.error('❌ Automation Error:', err));

    res.status(202).json({
        message: 'Automation started',
        timestamp: new Date().toISOString()
    });
});

// Health check
app.get('/health', (req, res) => {
    res.send('Automation server is running.');
});

app.listen(PORT, () => {
    console.log(`🚀 Webhook server listening at http://localhost:${PORT}`);
    console.log(`🔗 n8n Endpoint: http://localhost:${PORT}/webhook/trigger (POST)`);
});
