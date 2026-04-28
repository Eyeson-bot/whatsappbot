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

// Store user sessions
const userSessions = new Map();

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
            keepAliveIntervalMs: 30000,
            connectTimeoutMs: 60000,
            generateHighQualityLinkPreview: false,
            defaultQueryTimeoutMs: undefined,
            markOnlineOnConnect: true,
            syncFullHistory: false
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
                    setTimeout(() => {
                        createBotForRestaurant(restaurantId, restaurantData, true);
                    }, 10000);
                }
            }
        });
        
        sock.ev.on('creds.update', saveCreds);
        
        // Initialize user sessions for this restaurant
        if (!userSessions.has(restaurantId)) {
            userSessions.set(restaurantId, new Map());
        }
        const restaurantSessions = userSessions.get(restaurantId);
        
        // Message handler for this restaurant
        sock.ev.on('messages.upsert', async (m) => {
            const msg = m.messages[0];
            if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;
            if (msg.key.fromMe) return;
            
            const sender = msg.key.remoteJid;
            const waNumber = sender.split('@')[0];
            
            // Get message text properly
            let text = '';
            if (msg.message.conversation) {
                text = msg.message.conversation;
            } else if (msg.message.extendedTextMessage) {
                text = msg.message.extendedTextMessage.text;
            } else if (msg.message.imageMessage) {
                text = '📷 Image received';
            } else if (msg.message.videoMessage) {
                text = '🎥 Video received';
            } else {
                text = 'Media received';
            }
            
            text = text.trim().toLowerCase();
            
            console.log(`📩 [${restaurantData.name}] ${waNumber}: ${text}`);
            
            // Get or create user session
            if (!restaurantSessions.has(waNumber)) {
                restaurantSessions.set(waNumber, { step: 'IDLE', cart: [] });
            }
            let session = restaurantSessions.get(waNumber);
            
            // Get restaurant's menu only
            const menu = await getRestaurantMenu(restaurantId);
            
            // Handle Menu Command
            if (text === "menu" || text === "food" || text === "dishes" || text === "menu " || text === "food ") {
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
                menuMessage += `• *help* - All commands`;
                
                await sock.sendMessage(sender, { text: menuMessage });
                return;
            }
            
            // Handle Help Command
            if (text === "help" || text === "commands" || text === "?" || text === "help ") {
                const helpMsg = `
🤖 *${restaurantData.name} Bot Commands*

🛒 *Ordering:*
• *menu* - View our menu
• *order [item]* - Place an order

📦 *Tracking:*
• *track* - See your orders

💡 *Examples:*
• menu
• order biryani
• track

━━━━━━━━━━━━━━━━━━━━
_Need help? Contact restaurant directly_
`;
                await sock.sendMessage(sender, { text: helpMsg });
                return;
            }
            
            // Handle Track Command
            if (text === "track" || text === "track " || text === "my orders") {
                await sock.sendMessage(sender, { 
                    text: `📭 *No Orders Found*\n\nYou haven't placed any orders with ${restaurantData.name} yet.\n\nType *menu* to see our food and place an order!` 
                });
                return;
            }
            
            // Handle Order Command
            if (text.startsWith("order ")) {
                const productRequested = text.replace("order ", "").trim();
                if (!productRequested) {
                    await sock.sendMessage(sender, { 
                        text: `🛒 *How to order:*\n\nType *order [dish name]*\nExample: *order biryani*\n\nType *menu* to see all items.` 
                    });
                    return;
                }
                
                const matchedItem = menu.find(item => item.name.toLowerCase().includes(productRequested.toLowerCase()));
                
                if (!matchedItem) {
                    await sock.sendMessage(sender, { 
                        text: `❌ Sorry, couldn't find *${productRequested}* in *${restaurantData.name}* menu.\n\nType *menu* to see all available items.` 
                    });
                    return;
                }
                
                // Simple order response
                await sock.sendMessage(sender, { 
                    text: `🛒 *Order Received!*\n\nItem: ${matchedItem.name}\nPrice: ${formatCurrency(matchedItem.price)}\nRestaurant: ${restaurantData.name}\n\nPlease reply with your delivery address to confirm your order.\n\nType *cancel* to cancel.` 
                });
                session.step = 'WAITING_ADDRESS';
                session.selectedItem = matchedItem;
                restaurantSessions.set(waNumber, session);
                return;
            }
            
            // Handle Address input for order
            if (session.step === 'WAITING_ADDRESS') {
                if (text === "cancel") {
                    session.step = 'IDLE';
                    session.selectedItem = null;
                    restaurantSessions.set(waNumber, session);
                    await sock.sendMessage(sender, { text: `❌ Order cancelled.` });
                    return;
                }
                
                // Create order object
                const order = {
                    restaurantId: restaurantId,
                    restaurantName: restaurantData.name,
                    customerWaNumber: waNumber,
                    customerName: waNumber,
                    phone: waNumber,
                    address: text,
                    items: [{
                        id: session.selectedItem.id,
                        name: session.selectedItem.name,
                        price: session.selectedItem.price,
                        quantity: 1
                    }],
                    subtotal: session.selectedItem.price,
                    tax: session.selectedItem.price * 0.05,
                    deliveryFee: DELIVERY_FEE,
                    total: session.selectedItem.price + (session.selectedItem.price * 0.05) + DELIVERY_FEE,
                    status: "Placed",
                    method: "Cash on Delivery",
                    timestamp: Date.now(),
                    source: `WhatsApp Bot - ${restaurantData.name}`
                };
                
                // Save order to Firebase
                const orderRef = await fetch(`${FIREBASE_URL}/orders.json`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(order)
                });
                const orderResult = await orderRef.json();
                const orderId = orderResult.name;
                
                await sock.sendMessage(sender, { 
                    text: `✅ *ORDER CONFIRMED!* ✅

*Order ID:* #${orderId.substring(0,8)}
*Restaurant:* ${restaurantData.name}
*Item:* ${session.selectedItem.name}
*Total:* ${formatCurrency(order.total)}

You can track your order anytime with:
*track ${orderId.substring(0,8)}*

Thank you for ordering from ${restaurantData.name}! 🍔

📞 For support, contact the restaurant directly.` 
                });
                
                session.step = 'IDLE';
                session.selectedItem = null;
                restaurantSessions.set(waNumber, session);
                return;
            }
            
            // Handle Greetings - FIXED: This will respond to "hi", "hello", etc.
            if (text === "hi" || text === "hello" || text === "hey" || text === "start" || text === "greetings") {
                await sock.sendMessage(sender, { 
                    text: `👋 *Welcome to ${restaurantData.name}!* 🍔

🍕 *Get Started:*
1️⃣ Type *menu* to see our food
2️⃣ Type *order [dish]* to place order
3️⃣ Type *help* for all commands

_What would you like to order today?_` 
                });
                return;
            }
            
            // Handle invalid commands - Send help
            await sock.sendMessage(sender, { 
                text: `🤔 I didn't understand "*${text}*".\n\nType *help* for commands or *menu* to see our food from ${restaurantData.name}!\n\n💡 *Tip:* Type *menu* to get started!` 
            });
        });
        
        activeBots.set(restaurantId, sock);
        
        // Send heartbeat every 60 seconds to keep connection alive
        const heartbeat = setInterval(async () => {
            if (sock && sock.user) {
                console.log(`💓 [${restaurantData.name}] Heartbeat - ${new Date().toISOString()}`);
            }
        }, 60000);
        
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
    console.log("🚀 JAVAGOAT MULTI-BOT MANAGER v6.0");
    console.log("🔋 Auto-Reconnect & Session Persistence Enabled");
    console.log("=".repeat(60));
    console.log(`📡 Firebase URL: ${FIREBASE_URL ? FIREBASE_URL.substring(0, 50) + '...' : 'NOT SET'}\n`);
    
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
    console.log("\n💡 TEST YOUR BOT:");
    console.log("   1. Open WhatsApp on your phone");
    console.log("   2. Message your restaurant's WhatsApp number");
    console.log("   3. Type 'hi' or 'menu' to test");
    console.log("   4. Bot should respond immediately\n");
    
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
    console.log('🔄 Attempting to continue...');
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection:', reason);
});

// Start the bot manager
console.log("🐐 JavaGoat WhatsApp Bot Starting...");
startAllBots().catch(console.error);
