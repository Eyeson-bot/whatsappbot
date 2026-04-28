const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const fetch = require('node-fetch');
const fs = require('fs');

// Firebase Configuration
const FIREBASE_URL = process.env.FIREBASE_URL;

// Store all active bot instances
const activeBots = new Map();
const reconnectAttempts = new Map();

// Configuration
const DELIVERY_FEE = 150;
const TAX_RATE = 0.05;

// Create sessions directory if not exists
if (!fs.existsSync('sessions')) {
    fs.mkdirSync('sessions', { recursive: true });
}

// Helper function to fetch from Firebase
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

// Update bot status
async function updateBotStatus(restaurantId, status, message = '') {
    await putToFirebase(`whatsapp_bots/${restaurantId}`, {
        status: status,
        lastUpdate: Date.now(),
        message: message,
        reconnectAttempts: reconnectAttempts.get(restaurantId) || 0
    });
}

// Store QR codes in database for admin to view
async function storeQRCode(restaurantId, qrData) {
    await putToFirebase(`whatsapp_bots/${restaurantId}`, {
        qrCode: qrData,
        qrGeneratedAt: Date.now(),
        status: 'waiting_qr'
    });
}

// Get restaurant menu
async function getRestaurantMenu(restaurantId) {
    const dishes = await fetchFromFirebase('dishes');
    if (!dishes) return [];
    
    const menu = [];
    for (const [key, value] of Object.entries(dishes)) {
        if (value.restaurantId === restaurantId) {
            menu.push({ id: key, ...value });
        }
    }
    return menu;
}

function formatCurrency(amount) {
    return `₨${parseFloat(amount).toFixed(2)}`;
}

// Create bot for a specific restaurant with auto-reconnect
async function createBotForRestaurant(restaurantId, restaurantData, isReconnect = false) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`${isReconnect ? '🔄 RECONNECTING' : '🤖 CREATING'} BOT FOR: ${restaurantData.name}`);
    console.log(`📞 WhatsApp Number: ${restaurantData.whatsappNumber}`);
    console.log(`${'='.repeat(60)}`);
    
    try {
        const { state, saveCreds } = await useMultiFileAuthState(`sessions/${restaurantId}`);
        const { version } = await fetchLatestBaileysVersion();
        
        const sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: true,
            logger: pino({ level: 'error' }),
            browser: [`JavaGoat_${restaurantData.name}`, "Chrome", "1.0"],
            // Important: Keep connection alive
            keepAliveIntervalMs: 30000,
            connectTimeoutMs: 60000,
            generateHighQualityLinkPreview: false
        });
        
        let qrDisplayed = false;
        
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr && !qrDisplayed) {
                qrDisplayed = true;
                console.log(`\n📱 QR CODE FOR ${restaurantData.name.toUpperCase()}:`);
                console.log(`🖨️ Scan this QR with WhatsApp number: ${restaurantData.whatsappNumber}`);
                console.log(`${'='.repeat(40)}`);
                qrcode.generate(qr, { small: true });
                console.log(`${'='.repeat(40)}\n`);
                
                // Store QR in Firebase for web display
                await storeQRCode(restaurantId, qr);
                await updateBotStatus(restaurantId, 'waiting_qr', 'Scan QR code with WhatsApp');
            }
            
            if (connection === 'open') {
                qrDisplayed = false;
                console.log(`\n✅ ${restaurantData.name} BOT IS ONLINE!`);
                console.log(`📱 Customers can now order by messaging: ${restaurantData.whatsappNumber}`);
                await updateBotStatus(restaurantId, 'online', 'Bot is active and taking orders');
                // Reset reconnect attempts on successful connection
                reconnectAttempts.set(restaurantId, 0);
            }
            
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                console.log(`\n❌ ${restaurantData.name} bot disconnected. Code: ${statusCode}`);
                
                const attempts = (reconnectAttempts.get(restaurantId) || 0) + 1;
                reconnectAttempts.set(restaurantId, attempts);
                
                await updateBotStatus(restaurantId, 'reconnecting', `Reconnect attempt ${attempts}`);
                
                if (statusCode !== DisconnectReason.loggedOut) {
                    const delay = Math.min(5000 * attempts, 60000);
                    console.log(`🔄 Reconnecting in ${delay/1000} seconds... (Attempt ${attempts})`);
                    setTimeout(() => {
                        createBotForRestaurant(restaurantId, restaurantData, true);
                    }, delay);
                } else {
                    console.log(`⚠️ Bot logged out. Please scan QR code again.`);
                    await updateBotStatus(restaurantId, 'logged_out', 'Need to re-scan QR code');
                    // Force QR regeneration after logout
                    setTimeout(() => {
                        createBotForRestaurant(restaurantId, restaurantData, true);
                    }, 10000);
                }
            }
        });
        
        sock.ev.on('creds.update', saveCreds);
        
        // Message handler for this restaurant
        sock.ev.on('messages.upsert', async (m) => {
            const msg = m.messages[0];
            if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;
            if (msg.key.fromMe) return;
            
            const sender = msg.key.remoteJid;
            const waNumber = sender.split('@')[0];
            const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim().toLowerCase();
            
            console.log(`📩 [${restaurantData.name}] ${waNumber}: ${text}`);
            
            // Get restaurant's menu only
            const menu = await getRestaurantMenu(restaurantId);
            
            // Handle Menu Command
            if (text === "menu" || text === "food" || text === "dishes") {
                if (menu.length === 0) {
                    await sock.sendMessage(sender, { 
                        text: `🍽️ *${restaurantData.name}*\n\nSorry, our menu is currently empty. Please check back later!` 
                    });
                    return;
                }
                
                let menuMessage = `🍔 *${restaurantData.name.toUpperCase()} MENU* 🍕\n\n`;
                menuMessage += `━━━━━━━━━━━━━━━━━━━━\n`;
                menu.slice(0, 15).forEach((item, idx) => {
                    menuMessage += `${idx + 1}. *${item.name}*\n`;
                    menuMessage += `   💰 ${formatCurrency(item.price)}\n`;
                    menuMessage += `   ━━━━━━━━━━━━━━━\n`;
                });
                menuMessage += `\n📝 *How to order:*\n`;
                menuMessage += `Type *order [dish name]*\n`;
                menuMessage += `Example: *order ${menu[0]?.name || 'food'}*\n\n`;
                menuMessage += `✨ *Commands:*\n`;
                menuMessage += `• *cart* - View cart\n`;
                menuMessage += `• *checkout* - Place order\n`;
                menuMessage += `• *track* - Track orders\n`;
                menuMessage += `• *help* - All commands`;
                
                await sock.sendMessage(sender, { text: menuMessage });
                return;
            }
            
            // Handle Help Command
            if (text === "help" || text === "commands" || text === "?") {
                await sock.sendMessage(sender, { 
                    text: `🤖 *${restaurantData.name} Bot Commands*\n\n🛒 *Ordering:*\n• *menu* - View our menu\n• *order [item]* - Add to cart\n• *cart* - View cart\n• *checkout* - Place order\n\n📦 *Tracking:*\n• *track* - See your orders\n\n💡 *Example:*\norder biryani\ncheckout\n\nType *menu* to get started!` 
                });
                return;
            }
            
            // Handle Greetings
            if (text.match(/^(hi|hello|hey|start|greetings)$/i)) {
                await sock.sendMessage(sender, { 
                    text: `👋 *Welcome to ${restaurantData.name}!* 🍔\n\n🍕 *Get Started:*\n1️⃣ Type *menu* to see our food\n2️⃣ Type *order [dish]* to order\n3️⃣ Type *checkout* when ready\n\n📦 *Track orders:* track\n\n_What would you like to order today?_` 
                });
                return;
            }
            
            // Handle Order Command (simplified)
            if (text.startsWith("order ")) {
                const productRequested = text.replace("order ", "").trim().toLowerCase();
                const matchedItem = menu.find(item => item.name.toLowerCase().includes(productRequested));
                
                if (!matchedItem) {
                    await sock.sendMessage(sender, { 
                        text: `❌ Sorry, couldn't find *${productRequested}* in *${restaurantData.name}* menu.\n\nType *menu* to see all available items.` 
                    });
                    return;
                }
                
                await sock.sendMessage(sender, { 
                    text: `🛒 *${matchedItem.name}* - ${formatCurrency(matchedItem.price)}\n\nPlease reply with your delivery address to place order.\n\nType *cancel* to cancel.` 
                });
                return;
            }
            
            // Handle Cart command
            if (text === "cart") {
                await sock.sendMessage(sender, { 
                    text: `🛒 *Your cart is empty*\n\nAdd items using *order [dish name]*\nType *menu* to see our food!` 
                });
                return;
            }
            
            // Handle Track command
            if (text === "track") {
                await sock.sendMessage(sender, { 
                    text: `📭 *No Orders Found*\n\nYou haven't placed any orders with ${restaurantData.name} yet.\n\nType *menu* to see our food!` 
                });
                return;
            }
            
            // Default response
            await sock.sendMessage(sender, { 
                text: `🤔 I didn't understand.\n\nType *help* for commands or *menu* to see our food from ${restaurantData.name}!\n\n💡 *Tip:* Type *menu* to get started!` 
            });
        });
        
        activeBots.set(restaurantId, sock);
        
        // Send heartbeat every 30 seconds to keep connection alive
        const heartbeat = setInterval(async () => {
            if (sock && sock.user) {
                console.log(`💓 [${restaurantData.name}] Heartbeat - ${new Date().toISOString()}`);
                await updateBotStatus(restaurantId, 'online', 'Bot is active');
            }
        }, 30000);
        
        // Store heartbeat interval to clear on disconnect
        sock.heartbeat = heartbeat;
        
        return sock;
        
    } catch (error) {
        console.error(`❌ Error creating bot for ${restaurantData.name}:`, error);
        
        // Schedule reconnect on error
        setTimeout(() => {
            createBotForRestaurant(restaurantId, restaurantData, true);
        }, 15000);
        
        return null;
    }
}

// Start all restaurant bots
async function startAllBots() {
    console.log("\n" + "=".repeat(60));
    console.log("🚀 JAVAGOAT MULTI-BOT MANAGER v5.0");
    console.log("🔋 Auto-Reconnect & Session Persistence Enabled");
    console.log("=".repeat(60));
    console.log(`📡 Firebase URL: ${FIREBASE_URL}\n`);
    
    if (!FIREBASE_URL) {
        console.error("❌ ERROR: FIREBASE_URL environment variable not set!");
        process.exit(1);
    }
    
    const restaurants = await fetchFromFirebase('restaurants');
    if (!restaurants) {
        console.log("❌ No restaurants found. Add restaurants from admin panel first.");
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
        console.log("Please add restaurants from the admin panel first.");
        return;
    }
    
    console.log(`📊 Found ${activeRestaurants.length} restaurant(s) to connect:\n`);
    activeRestaurants.forEach((rest, idx) => {
        console.log(`   ${idx + 1}. ${rest.name} - WhatsApp: ${rest.whatsappNumber}`);
    });
    console.log("\n" + "=".repeat(60));
    
    let botCount = 0;
    for (const rest of activeRestaurants) {
        botCount++;
        console.log(`\n[${botCount}/${activeRestaurants.length}] Starting bot for ${rest.name}...`);
        await createBotForRestaurant(rest.id, rest);
        // Wait 8 seconds between bot creations to avoid rate limiting
        if (botCount < activeRestaurants.length) {
            console.log(`⏳ Waiting 8 seconds before starting next bot...`);
            await new Promise(resolve => setTimeout(resolve, 8000));
        }
    }
    
    console.log("\n" + "=".repeat(60));
    console.log(`✅ ${botCount} BOT(S) STARTED SUCCESSFULLY!`);
    console.log("🔄 Auto-reconnect enabled");
    console.log("💾 Sessions are saved between restarts");
    console.log("=".repeat(60));
    console.log("\n💡 NEXT STEPS:");
    console.log("   1. Scan the QR codes above with their respective WhatsApp numbers");
    console.log("   2. Bots will stay connected 24/7");
    console.log("   3. If disconnected, bots will auto-reconnect\n");
    
    // Keep process alive
    setInterval(() => {
        const onlineCount = Array.from(activeBots.values()).filter(sock => sock && sock.user).length;
        console.log(`💓 System Heartbeat - ${new Date().toISOString()} - ${onlineCount}/${activeRestaurants.length} bots online`);
    }, 60000);
}

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down gracefully...');
    for (const [id, sock] of activeBots) {
        if (sock && sock.end) {
            await sock.end();
        }
        if (sock && sock.heartbeat) {
            clearInterval(sock.heartbeat);
        }
    }
    process.exit(0);
});

// Error handlers
process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection:', reason);
});

// Start the bot manager
startAllBots().catch(console.error);
