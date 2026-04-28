const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const fetch = require('node-fetch');
const fs = require('fs');

const FIREBASE_URL = process.env.FIREBASE_URL;

// Create sessions directory
if (!fs.existsSync('sessions')) {
    fs.mkdirSync('sessions', { recursive: true });
}

// Store active connections
const activeBots = new Map();

async function fetchFromFirebase(path) {
    try {
        const response = await fetch(`${FIREBASE_URL}/${path}.json`);
        return await response.json();
    } catch (error) {
        console.error(`Firebase error: ${error}`);
        return null;
    }
}

async function createBotForRestaurant(restaurantId, restaurantData) {
    console.log(`\n🤖 Starting bot for: ${restaurantData.name}`);
    console.log(`📞 Number: ${restaurantData.whatsappNumber}`);
    
    try {
        const { state, saveCreds } = await useMultiFileAuthState(`sessions/${restaurantId}`);
        const { version } = await fetchLatestBaileysVersion();
        
        const sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: true,
            logger: pino({ level: 'error' }),
            browser: [`JavaGoat_${restaurantData.name}`, "Chrome", "1.0"],
            keepAliveIntervalMs: 30000
        });
        
        let qrSent = false;
        
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr && !qrSent) {
                qrSent = true;
                console.log(`\n📱 QR CODE FOR ${restaurantData.name}:`);
                qrcode.generate(qr, { small: true });
            }
            
            if (connection === 'open') {
                console.log(`✅ ${restaurantData.name} is ONLINE!`);
                qrSent = false;
            }
            
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                console.log(`❌ ${restaurantData.name} disconnected: ${statusCode}`);
                
                if (statusCode !== DisconnectReason.loggedOut) {
                    console.log(`🔄 Reconnecting in 10 seconds...`);
                    setTimeout(() => createBotForRestaurant(restaurantId, restaurantData), 10000);
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
            
            console.log(`📩 [${restaurantData.name}] ${sender}: ${text}`);
            
            if (text === "menu") {
                await sock.sendMessage(sender, { 
                    text: `🍔 *${restaurantData.name}*\n\nType *menu* to see our food\nThank you for choosing us!` 
                });
            } else if (text === "help") {
                await sock.sendMessage(sender, { 
                    text: `🤖 *${restaurantData.name} Bot*\n\n• menu - View menu\n• help - This menu` 
                });
            } else {
                await sock.sendMessage(sender, { 
                    text: `👋 Welcome to ${restaurantData.name}! Type *menu* to see our food.` 
                });
            }
        });
        
        activeBots.set(restaurantId, sock);
        
    } catch (error) {
        console.error(`Error creating bot for ${restaurantData.name}:`, error);
        setTimeout(() => createBotForRestaurant(restaurantId, restaurantData), 15000);
    }
}

async function startAllBots() {
    console.log("\n🚀 JAVA GOAT WHATSAPP BOT");
    console.log("=".repeat(40));
    
    if (!FIREBASE_URL) {
        console.error("❌ FIREBASE_URL not set!");
        process.exit(1);
    }
    
    const restaurants = await fetchFromFirebase('restaurants');
    if (!restaurants) {
        console.log("❌ No restaurants found");
        return;
    }
    
    let botCount = 0;
    for (const [id, data] of Object.entries(restaurants)) {
        if (data.status === 'active' && data.whatsappNumber) {
            botCount++;
            await createBotForRestaurant(id, data);
            await new Promise(r => setTimeout(r, 5000));
        }
    }
    
    console.log(`\n✅ ${botCount} bot(s) started`);
}

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err.message);
});

startAllBots().catch(console.error);
