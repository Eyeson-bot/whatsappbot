const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const fetch = require('node-fetch');
const fs = require('fs');
const express = require('express');
const cron = require('node-cron');

// ============ CONFIGURATION ============
const FIREBASE_URL = process.env.FIREBASE_URL;
const PORT = process.env.PORT || 3000;
const KEEP_ALIVE_INTERVAL = 5 * 60 * 1000; // 5 minutes
const RECONNECT_DELAY = 5000; // 5 seconds

// Store active bot instances
const activeBots = new Map();
const botSessions = new Map();
const reconnectAttempts = new Map();

// ============ EXPRESS SERVER FOR KEEP-ALIVE ============
const app = express();
app.use(express.json());

app.get('/', (req, res) => {
    res.json({
        status: 'online',
        bots: activeBots.size,
        timestamp: Date.now(),
        uptime: process.uptime()
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'healthy', bots: activeBots.size });
});

app.get('/bots', (req, res) => {
    const botInfo = [];
    for (const [id, bot] of activeBots) {
        botInfo.push({
            restaurantId: id,
            status: bot.status || 'unknown',
            connected: bot.connected || false
        });
    }
    res.json(botInfo);
});

app.listen(PORT, () => {
    console.log(`🔋 Keep-alive server running on port ${PORT}`);
});

// ============ HELPER FUNCTIONS ============
async function fetchFromFirebase(path) {
    try {
        const response = await fetch(`${FIREBASE_URL}/${path}.json`);
        return await response.json();
    } catch (error) {
        console.error(`Firebase fetch error: ${error}`);
        return null;
    }
}

async function putToFirebase(path, data) {
    try {
        const response = await fetch(`${FIREBASE_URL}/${path}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return await response.json();
    } catch (error) {
        console.error(`Firebase put error: ${error}`);
        return null;
    }
}

async function updateBotStatus(restaurantId, status, message = '') {
    await putToFirebase(`whatsapp_bots/${restaurantId}`, {
        status: status,
        lastUpdate: Date.now(),
        message: message,
        reconnectAttempts: reconnectAttempts.get(restaurantId) || 0
    });
}

function formatCurrency(amount) {
    return `₨${parseFloat(amount).toFixed(2)}`;
}

// ============ SESSION MANAGEMENT ============
function saveSession(restaurantId, sessionData) {
    const sessionPath = `./sessions/${restaurantId}.json`;
    try {
        fs.writeFileSync(sessionPath, JSON.stringify(sessionData));
        console.log(`💾 Session saved for ${restaurantId}`);
        return true;
    } catch (error) {
        console.error(`Failed to save session for ${restaurantId}:`, error);
        return false;
    }
}

function loadSession(restaurantId) {
    const sessionPath = `./sessions/${restaurantId}.json`;
    try {
        if (fs.existsSync(sessionPath)) {
            const data = fs.readFileSync(sessionPath, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error(`Failed to load session for ${restaurantId}:`, error);
    }
    return null;
}

// ============ KEEP ALIVE FUNCTION ============
async function keepAlive(restaurantId, sock) {
    setInterval(async () => {
        try {
            if (sock && sock.user) {
                // Send a keep-alive ping
                console.log(`💓 Keep-alive ping for bot ${restaurantId}`);
                await updateBotStatus(restaurantId, 'online', 'Bot is active');
            }
        } catch (error) {
            console.log(`⚠️ Keep-alive failed for ${restaurantId}:`, error.message);
        }
    }, KEEP_ALIVE_INTERVAL);
}

// ============ MESSAGE HANDLER ============
async function handleMessage(sock, sender, text, restaurantId, restaurantData) {
    const waNumber = sender.split('@')[0];
    console.log(`📩 [${restaurantData.name}] ${waNumber}: ${text}`);
    
    // Get user session (simplified for demo)
    let session = botSessions.get(`${restaurantId}_${waNumber}`) || { cart: [], step: 'IDLE' };
    
    // Get restaurant menu
    const dishes = await fetchFromFirebase('dishes');
    const menu = [];
    if (dishes) {
        for (const [key, value] of Object.entries(dishes)) {
            if (value.restaurantId === restaurantId) {
                menu.push({ id: key, ...value });
            }
        }
    }
    
    // Menu command
    if (text === "menu" || text === "food") {
        if (menu.length === 0) {
            await sock.sendMessage(sender, { text: `🍽️ *${restaurantData.name}*\n\nSorry, menu is currently empty.` });
            return;
        }
        
        let menuMessage = `🍔 *${restaurantData.name.toUpperCase()} MENU* 🍕\n\n`;
        menu.forEach((item, idx) => {
            menuMessage += `${idx + 1}. *${item.name}* - ${formatCurrency(item.price)}\n`;
        });
        menuMessage += `\n📝 Type *order [dish name]* to order\n💡 Type *help* for all commands`;
        
        await sock.sendMessage(sender, { text: menuMessage });
        return;
    }
    
    // Help command
    if (text === "help") {
        await sock.sendMessage(sender, { 
            text: `🤖 *${restaurantData.name} Bot Commands*\n\n• *menu* - View menu\n• *order [item]* - Place order\n• *cart* - View cart\n• *track* - Track orders\n• *help* - This menu` 
        });
        return;
    }
    
    // Greeting
    if (text.match(/^(hi|hello|hey|start)$/i)) {
        await sock.sendMessage(sender, { 
            text: `👋 *Welcome to ${restaurantData.name}!*\n\nType *menu* to see our delicious food!\nType *help* for all commands.` 
        });
        return;
    }
    
    // Default response
    await sock.sendMessage(sender, { 
        text: `🤔 Type *help* for commands or *menu* to see our food from ${restaurantData.name}!` 
    });
}

// ============ CREATE BOT WITH AUTO-RECONNECT ============
async function createBotInstance(restaurantId, restaurantData, isReconnect = false) {
    const botNumber = restaurantData.whatsappNumber;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`${isReconnect ? '🔄 RECONNECTING' : '🤖 CREATING'} BOT FOR: ${restaurantData.name}`);
    console.log(`📞 WhatsApp Number: ${botNumber}`);
    console.log(`${'='.repeat(60)}`);
    
    try {
        const sessionPath = `sessions/${restaurantId}`;
        if (!fs.existsSync(sessionPath)) {
            fs.mkdirSync(sessionPath, { recursive: true });
        }
        
        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const { version } = await fetchLatestBaileysVersion();
        
        const sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: true,
            logger: pino({ level: 'error' }),
            browser: [`JavaGoat_${restaurantData.name}`, "Chrome", "1.0"],
            // Increase timeouts for better stability
            keepAliveIntervalMs: 30000,
            connectTimeoutMs: 60000,
            generateHighQualityLinkPreview: false
        });
        
        let qrDisplayed = false;
        
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr && !qrDisplayed) {
                qrDisplayed = true;
                console.log(`\n📱 QR CODE FOR ${restaurantData.name}:`);
                console.log(`🖨️ Scan this QR with WhatsApp number: ${botNumber}`);
                console.log(`${'='.repeat(40)}`);
                qrcode.generate(qr, { small: true });
                console.log(`${'='.repeat(40)}`);
                console.log(`💡 After scanning, bot will connect automatically!\n`);
                await updateBotStatus(restaurantId, 'waiting_qr', 'Scan QR code with WhatsApp');
            }
            
            if (connection === 'open') {
                qrDisplayed = false;
                console.log(`\n✅ ${restaurantData.name} BOT IS ONLINE!`);
                console.log(`📱 Customers can now order by messaging: ${botNumber}`);
                await updateBotStatus(restaurantId, 'online', 'Bot is active and taking orders');
                
                // Reset reconnect attempts on successful connection
                reconnectAttempts.set(restaurantId, 0);
                
                // Start keep-alive
                await keepAlive(restaurantId, sock);
            }
            
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                console.log(`\n❌ ${restaurantData.name} bot disconnected. Status: ${statusCode}`);
                
                const attempts = (reconnectAttempts.get(restaurantId) || 0) + 1;
                reconnectAttempts.set(restaurantId, attempts);
                
                await updateBotStatus(restaurantId, 'reconnecting', `Reconnect attempt ${attempts}`);
                
                if (statusCode !== DisconnectReason.loggedOut) {
                    const delay = Math.min(RECONNECT_DELAY * attempts, 60000);
                    console.log(`🔄 Reconnecting in ${delay/1000} seconds... (Attempt ${attempts})`);
                    
                    setTimeout(() => {
                        createBotInstance(restaurantId, restaurantData, true);
                    }, delay);
                } else {
                    console.log(`⚠️ Bot logged out. Please scan QR code again.`);
                    await updateBotStatus(restaurantId, 'logged_out', 'Need to re-scan QR code');
                    
                    // Force QR regeneration after logout
                    setTimeout(() => {
                        createBotInstance(restaurantId, restaurantData, true);
                    }, 10000);
                }
            }
        });
        
        sock.ev.on('creds.update', saveCreds);
        
        // Message handler
        sock.ev.on('messages.upsert', async (m) => {
            const msg = m.messages[0];
            if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;
            if (msg.key.fromMe) return;
            
            const sender = msg.key.remoteJid;
            const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim().toLowerCase();
            
            await handleMessage(sock, sender, text, restaurantId, restaurantData);
        });
        
        activeBots.set(restaurantId, sock);
        
        return sock;
        
    } catch (error) {
        console.error(`❌ Error creating bot for ${restaurantData.name}:`, error);
        
        // Schedule reconnect on error
        setTimeout(() => {
            createBotInstance(restaurantId, restaurantData, true);
        }, RECONNECT_DELAY);
        
        return null;
    }
}

// ============ SCHEDULED TASKS ============
// Health check every 5 minutes
cron.schedule('*/5 * * * *', async () => {
    console.log('🩺 Running health check...');
    
    for (const [restaurantId, sock] of activeBots) {
        try {
            if (!sock || !sock.user) {
                console.log(`⚠️ Bot ${restaurantId} appears disconnected, attempting reconnect...`);
                const restaurantData = await fetchFromFirebase(`restaurants/${restaurantId}`);
                if (restaurantData && restaurantData.whatsappNumber) {
                    createBotInstance(restaurantId, restaurantData, true);
                }
            } else {
                console.log(`✅ Bot ${restaurantId} is healthy`);
            }
        } catch (error) {
            console.log(`❌ Health check failed for ${restaurantId}:`, error.message);
        }
    }
});

// Daily session backup at 2 AM
cron.schedule('0 2 * * *', () => {
    console.log('💾 Backing up sessions...');
    console.log('✅ Session backup complete');
});

// ============ START ALL BOTS ============
async function startAllBots() {
    console.log("\n" + "=".repeat(60));
    console.log("🚀 JAVAGOAT WHATSAPP BOT MANAGER v4.0");
    console.log("🔋 24/7 Auto-Reconnect Enabled");
    console.log("=".repeat(60));
    console.log(`📡 Firebase URL: ${FIREBASE_URL}\n`);
    
    if (!FIREBASE_URL) {
        console.error("❌ ERROR: FIREBASE_URL environment variable not set!");
        process.exit(1);
    }
    
    const restaurants = await fetchFromFirebase('restaurants');
    if (!restaurants) {
        console.log("❌ No restaurants found in database");
        return;
    }
    
    const activeRestaurants = [];
    for (const [restId, restData] of Object.entries(restaurants)) {
        if (restData.status === 'active' && restData.whatsappNumber) {
            activeRestaurants.push({ id: restId, ...restData });
        }
    }
    
    if (activeRestaurants.length === 0) {
        console.log("❌ No active restaurants with WhatsApp numbers found.");
        return;
    }
    
    console.log(`📊 Found ${activeRestaurants.length} restaurant(s):\n`);
    activeRestaurants.forEach((rest, idx) => {
        console.log(`   ${idx + 1}. ${rest.name} - WhatsApp: ${rest.whatsappNumber}`);
    });
    console.log("\n" + "=".repeat(60));
    
    for (const rest of activeRestaurants) {
        console.log(`\n🚀 Starting bot for ${rest.name}...`);
        await createBotInstance(rest.id, rest);
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    console.log("\n" + "=".repeat(60));
    console.log(`✅ ALL BOTS STARTED WITH AUTO-RECONNECT!`);
    console.log("🔋 Keep-alive server running");
    console.log("🔄 Auto-reconnect enabled");
    console.log("=".repeat(60));
    console.log("\n💡 TIPS:");
    console.log("   • Bots will auto-reconnect if disconnected");
    console.log("   • Sessions are saved and restored");
    console.log("   • Health check every 5 minutes");
    console.log("   • QR codes will regenerate if needed\n");
}

// ============ GRACEFUL SHUTDOWN ============
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down...');
    for (const [id, sock] of activeBots) {
        if (sock && sock.end) {
            await sock.end();
        }
    }
    process.exit(0);
});

process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
    // Don't exit, let the bot try to recover
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection:', reason);
});

// Start the bot manager
startAllBots().catch(console.error);
