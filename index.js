const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const fetch = require('node-fetch');

// Firebase Configuration from GitHub Secrets
const FIREBASE_URL = process.env.FIREBASE_URL;

// Bot Configuration
const DELIVERY_FEE = 150;
const TAX_RATE = 0.05;

// Store active bot instances
const activeBots = new Map();
const userSessions = new Map();

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

async function postToFirebase(path, data) {
    try {
        const response = await fetch(`${FIREBASE_URL}/${path}.json`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return await response.json();
    } catch (error) {
        console.error(`Firebase post error: ${error}`);
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

// Get restaurant menu (only for specific restaurant)
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

// Save order
async function saveOrder(orderData) {
    return await postToFirebase('orders', orderData);
}

// Get user orders for specific restaurant
async function getUserOrders(waNumber, restaurantId) {
    const orders = await fetchFromFirebase('orders');
    if (!orders) return [];
    
    const userOrders = [];
    for (const [key, value] of Object.entries(orders)) {
        if (value.customerWaNumber === waNumber && value.restaurantId === restaurantId) {
            userOrders.push({ id: key, ...value });
        }
    }
    return userOrders.sort((a, b) => b.timestamp - a.timestamp);
}

// Update bot status
async function updateBotStatus(whatsappNumber, status, qrCode = null) {
    const updates = {
        status: status,
        lastUpdate: Date.now()
    };
    if (qrCode) updates.qrCode = qrCode;
    await putToFirebase(`whatsapp_bots/${whatsappNumber}`, updates);
}

function formatCurrency(amount) {
    return `₨${parseFloat(amount).toFixed(2)}`;
}

// Create bot instance for a restaurant
async function createBotInstance(restaurantId, restaurantData) {
    const botNumber = restaurantData.whatsappNumber;
    console.log(`\n${'='.repeat(50)}`);
    console.log(`🤖 Starting bot for: ${restaurantData.name}`);
    console.log(`📞 WhatsApp Number: ${botNumber}`);
    console.log(`${'='.repeat(50)}`);
    
    try {
        const { state, saveCreds } = await useMultiFileAuthState(`sessions/${restaurantId}`);
        const { version } = await fetchLatestBaileysVersion();
        
        const sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: 'error' }),
            browser: [`JavaGoat_${restaurantData.name}`, "Chrome", "1.0"]
        });
        
        await updateBotStatus(botNumber, 'connecting');
        
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                console.log(`\n📱 QR CODE FOR ${restaurantData.name}:`);
                console.log(`Scan this QR with WhatsApp to connect ${restaurantData.name} bot`);
                console.log(`${'='.repeat(40)}`);
                qrcode.generate(qr, { small: true });
                console.log(`${'='.repeat(40)}\n`);
                await updateBotStatus(botNumber, 'waiting_qr', String(qr));
            }
            
            if (connection === 'open') {
                console.log(`✅ ${restaurantData.name} bot is ONLINE!`);
                console.log(`📱 Customers can now order from ${restaurantData.name} on WhatsApp: ${botNumber}\n`);
                await updateBotStatus(botNumber, 'online');
            }
            
            if (connection === 'close') {
                const reason = lastDisconnect?.error?.output?.statusCode;
                console.log(`❌ ${restaurantData.name} bot disconnected`);
                await updateBotStatus(botNumber, 'offline');
                
                if (reason !== DisconnectReason.loggedOut) {
                    console.log(`🔄 Restarting bot for ${restaurantData.name} in 10 seconds...\n`);
                    setTimeout(() => createBotInstance(restaurantId, restaurantData), 10000);
                }
            }
        });
        
        sock.ev.on('creds.update', saveCreds);
        
        // Initialize user session storage
        if (!userSessions.has(restaurantId)) {
            userSessions.set(restaurantId, new Map());
        }
        const restaurantSessions = userSessions.get(restaurantId);
        
        // Message handler
        sock.ev.on('messages.upsert', async (m) => {
            const msg = m.messages[0];
            if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;
            if (msg.key.fromMe) return;
            
            const sender = msg.key.remoteJid;
            const waNumber = sender.split('@')[0];
            const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim().toLowerCase();
            
            console.log(`📩 [${restaurantData.name}] ${waNumber}: ${text}`);
            
            // Get or create user session
            if (!restaurantSessions.has(waNumber)) {
                restaurantSessions.set(waNumber, { step: 'IDLE', cart: [], tempData: {} });
            }
            let session = restaurantSessions.get(waNumber);
            
            // Get restaurant's menu only
            const menu = await getRestaurantMenu(restaurantId);
            
            // ============ MENU COMMAND ============
            if (text === "menu" || text === "food" || text === "dishes") {
                if (menu.length === 0) {
                    await sock.sendMessage(sender, { 
                        text: `🍽️ *${restaurantData.name}*\n\nSorry, our menu is currently empty. Please check back later!` 
                    });
                    return;
                }
                
                let menuMessage = `🍔 *${restaurantData.name.toUpperCase()}* 🍕\n\n`;
                menuMessage += `━━━━━━━━━━━━━━━━━━━━\n`;
                menu.forEach((item, idx) => {
                    menuMessage += `${idx + 1}. *${item.name}*\n`;
                    menuMessage += `   💰 ${formatCurrency(item.price)}\n`;
                    menuMessage += `   ━━━━━━━━━━━━━━━\n`;
                });
                menuMessage += `\n📝 *How to order:*\n`;
                menuMessage += `Type *order [dish name]*\n`;
                menuMessage += `Example: *order ${menu[0].name}*\n\n`;
                menuMessage += `✨ *Commands:*\n`;
                menuMessage += `• *cart* - View cart\n`;
                menuMessage += `• *checkout* - Place order\n`;
                menuMessage += `• *track* - Track orders\n`;
                menuMessage += `• *help* - All commands`;
                
                await sock.sendMessage(sender, { text: menuMessage });
                return;
            }
            
            // ============ ORDER COMMAND ============
            if (text.startsWith("order ") || text.startsWith("buy ")) {
                const productRequested = text.replace(/^(order|buy) /, "").trim().toLowerCase();
                const matchedItem = menu.find(item => item.name.toLowerCase().includes(productRequested));
                
                if (!matchedItem) {
                    await sock.sendMessage(sender, { 
                        text: `❌ Sorry, couldn't find *${productRequested}* in *${restaurantData.name}* menu.\n\nType *menu* to see all available items.` 
                    });
                    return;
                }
                
                session.step = 'WAITING_QUANTITY';
                session.tempData.selectedItem = matchedItem;
                restaurantSessions.set(waNumber, session);
                
                const msg = `🛒 *${matchedItem.name}* - ${formatCurrency(matchedItem.price)}\n\nReply with quantity (1-10):\n\nType *cancel* to cancel.`;
                
                if (matchedItem.imageUrl && matchedItem.imageUrl.startsWith('http')) {
                    await sock.sendMessage(sender, { image: { url: matchedItem.imageUrl }, caption: msg });
                } else {
                    await sock.sendMessage(sender, { text: msg });
                }
                return;
            }
            
            // Handle quantity input
            if (session.step === 'WAITING_QUANTITY') {
                if (text === "cancel") {
                    session.step = 'IDLE';
                    session.tempData = {};
                    restaurantSessions.set(waNumber, session);
                    await sock.sendMessage(sender, { text: `❌ Order cancelled.` });
                    return;
                }
                
                const quantity = parseInt(text);
                if (isNaN(quantity) || quantity < 1 || quantity > 10) {
                    await sock.sendMessage(sender, { text: `❌ Invalid quantity. Please enter 1-10.` });
                    return;
                }
                
                const item = session.tempData.selectedItem;
                const existing = session.cart.find(i => i.id === item.id);
                if (existing) {
                    existing.quantity += quantity;
                } else {
                    session.cart.push({
                        id: item.id,
                        name: item.name,
                        price: item.price,
                        quantity: quantity,
                        imageUrl: item.imageUrl
                    });
                }
                
                session.step = 'IDLE';
                session.tempData = {};
                restaurantSessions.set(waNumber, session);
                
                const itemCount = session.cart.reduce((sum, i) => sum + i.quantity, 0);
                const subtotal = session.cart.reduce((sum, i) => sum + (i.price * i.quantity), 0);
                
                await sock.sendMessage(sender, { 
                    text: `✅ *Added to Cart!*\n\n${quantity}x ${item.name} added.\n\n📦 Cart has ${itemCount} item(s)\n💰 Total: ${formatCurrency(subtotal)}\n\nType *cart* to view or *checkout* to place order.` 
                });
                return;
            }
            
            // ============ CART COMMAND ============
            if (text === "cart" || text === "view cart") {
                if (session.cart.length === 0) {
                    await sock.sendMessage(sender, { 
                        text: `🛒 *Your cart is empty*\n\nAdd items using *order [dish name]*\nType *menu* to see our food!` 
                    });
                    return;
                }
                
                let cartMsg = `🛒 *YOUR CART - ${restaurantData.name}* 🛒\n\n`;
                let subtotal = 0;
                session.cart.forEach((item, idx) => {
                    const itemTotal = item.price * item.quantity;
                    subtotal += itemTotal;
                    cartMsg += `${idx + 1}. ${item.name} x${item.quantity} = ${formatCurrency(itemTotal)}\n`;
                });
                
                const tax = subtotal * TAX_RATE;
                const total = subtotal + tax + DELIVERY_FEE;
                
                cartMsg += `\n━━━━━━━━━━━━━━━━━━━━\n`;
                cartMsg += `Subtotal: ${formatCurrency(subtotal)}\n`;
                cartMsg += `Tax (5%): ${formatCurrency(tax)}\n`;
                cartMsg += `Delivery: ${formatCurrency(DELIVERY_FEE)}\n`;
                cartMsg += `━━━━━━━━━━━━━━━━━━━━\n`;
                cartMsg += `*TOTAL: ${formatCurrency(total)}*\n\n`;
                cartMsg += `Type *checkout* to place order`;
                
                await sock.sendMessage(sender, { text: cartMsg });
                return;
            }
            
            // ============ CLEAR CART ============
            if (text === "clear cart" || text === "empty cart") {
                session.cart = [];
                restaurantSessions.set(waNumber, session);
                await sock.sendMessage(sender, { text: `🗑️ *Cart Cleared*\n\nType *menu* to start fresh.` });
                return;
            }
            
            // ============ REMOVE ITEM ============
            if (text.startsWith("remove ")) {
                const itemToRemove = text.replace("remove ", "").trim();
                const itemIndex = session.cart.findIndex(item => 
                    item.name.toLowerCase().includes(itemToRemove)
                );
                
                if (itemIndex !== -1) {
                    const removed = session.cart[itemIndex];
                    session.cart.splice(itemIndex, 1);
                    restaurantSessions.set(waNumber, session);
                    await sock.sendMessage(sender, { 
                        text: `🗑️ Removed *${removed.name}*\n\nType *cart* to see updated cart.` 
                    });
                } else {
                    await sock.sendMessage(sender, { 
                        text: `❌ Could not find "${itemToRemove}" in your cart.\n\nType *cart* to see what's inside.` 
                    });
                }
                return;
            }
            
            // ============ CHECKOUT ============
            if (text === "checkout" || text === "place order") {
                if (session.cart.length === 0) {
                    await sock.sendMessage(sender, { 
                        text: `🛒 *Cart is empty*\n\nAdd items first using *order [dish name]*` 
                    });
                    return;
                }
                
                session.step = 'WAITING_ADDRESS';
                restaurantSessions.set(waNumber, session);
                
                await sock.sendMessage(sender, { 
                    text: `📍 *Delivery Address*\n\nPlease provide your complete delivery address for *${restaurantData.name}*.\n\nExample: House #123, Street 5, DHA, Karachi` 
                });
                return;
            }
            
            if (session.step === 'WAITING_ADDRESS') {
                session.tempData.address = text;
                session.step = 'WAITING_PHONE';
                restaurantSessions.set(waNumber, session);
                
                await sock.sendMessage(sender, { 
                    text: `📱 *Phone Number*\n\nPlease provide your phone number for delivery coordination.\n\nExample: 03XX 1234567` 
                });
                return;
            }
            
            if (session.step === 'WAITING_PHONE') {
                session.tempData.phone = text;
                session.step = 'WAITING_NAME';
                restaurantSessions.set(waNumber, session);
                
                await sock.sendMessage(sender, { 
                    text: `👤 *Your Name*\n\nPlease provide your full name for delivery.` 
                });
                return;
            }
            
            if (session.step === 'WAITING_NAME') {
                session.tempData.customerName = text;
                session.step = 'CONFIRM_ORDER';
                restaurantSessions.set(waNumber, session);
                
                let subtotal = 0;
                let itemsList = '';
                session.cart.forEach((item, idx) => {
                    const itemTotal = item.price * item.quantity;
                    subtotal += itemTotal;
                    itemsList += `${idx + 1}. ${item.name} x${item.quantity} = ${formatCurrency(itemTotal)}\n`;
                });
                
                const tax = subtotal * TAX_RATE;
                const total = subtotal + tax + DELIVERY_FEE;
                
                const confirmMsg = `
╔════════════════════════════════╗
║        🛒 ORDER SUMMARY         ║
╚════════════════════════════════╝

*${restaurantData.name}*

${itemsList}

📊 *Bill Breakdown:*
Subtotal: ${formatCurrency(subtotal)}
Tax (5%): ${formatCurrency(tax)}
Delivery: ${formatCurrency(DELIVERY_FEE)}
━━━━━━━━━━━━━━━━━━━━
*TOTAL: ${formatCurrency(total)}*

👤 *Delivery Details:*
Name: ${session.tempData.customerName}
Phone: ${session.tempData.phone}
Address: ${session.tempData.address}

━━━━━━━━━━━━━━━━━━━━
*Reply with:*
✅ *CONFIRM* - Place order
❌ *CANCEL* - Cancel order`;
                
                await sock.sendMessage(sender, { text: confirmMsg });
                return;
            }
            
            if (session.step === 'CONFIRM_ORDER' && text === "confirm") {
                let subtotal = 0;
                session.cart.forEach(item => {
                    subtotal += item.price * item.quantity;
                });
                
                const tax = subtotal * TAX_RATE;
                const total = subtotal + tax + DELIVERY_FEE;
                
                const order = {
                    restaurantId: restaurantId,
                    restaurantName: restaurantData.name,
                    customerWaNumber: waNumber,
                    customerName: session.tempData.customerName,
                    phone: session.tempData.phone,
                    address: session.tempData.address,
                    items: session.cart,
                    subtotal: subtotal,
                    tax: tax,
                    deliveryFee: DELIVERY_FEE,
                    total: total,
                    status: "Placed",
                    method: "Cash on Delivery",
                    timestamp: Date.now(),
                    source: `WhatsApp Bot - ${restaurantData.name}`
                };
                
                const result = await saveOrder(order);
                const orderId = result?.name || `ORD_${Date.now()}`;
                
                await sock.sendMessage(sender, { 
                    text: `✅ *ORDER CONFIRMED!* ✅

*Order ID:* #${orderId.substring(0,8)}
*Restaurant:* ${restaurantData.name}
*Total:* ${formatCurrency(total)}

You can track your order anytime with:
*track ${orderId.substring(0,8)}*

Thank you for ordering from ${restaurantData.name}! 🍔` 
                });
                
                // Reset session
                session.cart = [];
                session.step = 'IDLE';
                session.tempData = {};
                restaurantSessions.set(waNumber, session);
                return;
            }
            
            // ============ TRACK ORDER ============
            if (text === "track") {
                const orders = await getUserOrders(waNumber, restaurantId);
                if (orders.length === 0) {
                    await sock.sendMessage(sender, { 
                        text: `📭 *No Orders Found*\n\nYou haven't placed any orders with ${restaurantData.name} yet.\n\nType *menu* to see our food!` 
                    });
                    return;
                }
                
                let msg = `📋 *YOUR ORDERS - ${restaurantData.name}* 📋\n\n`;
                orders.slice(0, 5).forEach(order => {
                    msg += `🔸 *#${order.id.substring(0,8)}* - ${order.status}\n`;
                    msg += `   💰 ${formatCurrency(order.total)}\n`;
                    msg += `   📅 ${new Date(order.timestamp).toLocaleDateString()}\n`;
                    msg += `   ━━━━━━━━━━━━━━━\n`;
                });
                msg += `\n_To track specific order: track ORDER_ID_`;
                
                await sock.sendMessage(sender, { text: msg });
                return;
            }
            
            if (text.startsWith("track ")) {
                const orderIdInput = text.replace("track", "").trim();
                const orders = await getUserOrders(waNumber, restaurantId);
                const order = orders.find(o => o.id === orderIdInput || o.id.substring(0,8) === orderIdInput);
                
                if (!order) {
                    await sock.sendMessage(sender, { 
                        text: `❌ *Order Not Found*\n\nType *track* to see your orders with ${restaurantData.name}.` 
                    });
                    return;
                }
                
                const statusEmojis = {
                    'Placed': '📋',
                    'Preparing': '🔪',
                    'Out for Delivery': '🚚',
                    'Delivered': '✅',
                    'Cancelled': '❌'
                };
                
                let trackingMsg = `
╔════════════════════════════════╗
║        🚚 ORDER TRACKING        ║
╚════════════════════════════════╝

*Restaurant:* ${restaurantData.name}
*Order ID:* #${order.id.substring(0,8)}
*Status:* ${statusEmojis[order.status] || '📋'} ${order.status}
*Total:* ${formatCurrency(order.total)}
*Date:* ${new Date(order.timestamp).toLocaleString()}

*Items:*
`;
                order.items.forEach(item => {
                    trackingMsg += `   • ${item.name} x${item.quantity} = ${formatCurrency(item.price * item.quantity)}\n`;
                });
                
                trackingMsg += `\n*Delivery Address:*\n${order.address}\n\n✨ *You'll receive automatic updates!*`;
                
                await sock.sendMessage(sender, { text: trackingMsg });
                return;
            }
            
            // ============ HELP COMMAND ============
            if (text === "help" || text === "commands" || text === "?") {
                const helpMsg = `
╔════════════════════════════════╗
║     🤖 JAVAGOAT BOT COMMANDS    ║
╚════════════════════════════════╝

*${restaurantData.name}*

🛒 *Ordering:*
• *menu* - See our menu
• *order [item]* - Add to cart
• *cart* - View cart
• *remove [item]* - Remove item
• *clear cart* - Empty cart
• *checkout* - Place order

📦 *Tracking:*
• *track* - See your orders
• *track [ID]* - Track specific order

💡 *Example:*
order biryani
checkout
track ORD_12345678

━━━━━━━━━━━━━━━━━━━━
_Type *menu* to get started!_`;
                
                await sock.sendMessage(sender, { text: helpMsg });
                return;
            }
            
            // ============ GREETINGS ============
            if (text.match(/^(hi|hello|hey|start|greetings)$/i)) {
                await sock.sendMessage(sender, { 
                    text: `👋 *Welcome to ${restaurantData.name}!* 🍔

🍕 *Get Started:*
1️⃣ Type *menu* to see our food
2️⃣ Type *order [dish]* to order
3️⃣ Type *checkout* when ready

📦 *Track orders:* track

_What would you like to order today?_` 
                });
                return;
            }
            
            // ============ CONTACT ============
            if (text.includes("contact") || text.includes("support")) {
                await sock.sendMessage(sender, { 
                    text: `📞 *${restaurantData.name} Support*

📧 Email: support@javagoat.com
⏰ Hours: 10 AM - 10 PM

For order issues, please share your Order ID.` 
                });
                return;
            }
            
            // Default response
            await sock.sendMessage(sender, { 
                text: `🤔 I didn't understand.\n\nType *help* for commands or *menu* to see our food from ${restaurantData.name}!\n\n💡 *Tip:* Type *order biryani* to start ordering!` 
            });
        });
        
        activeBots.set(restaurantId, sock);
        
    } catch (error) {
        console.error(`Error creating bot for ${restaurantData.name}:`, error);
    }
}

// Main function to start all bots
async function startAllBots() {
    console.log("\n" + "=".repeat(60));
    console.log("🚀 STARTING JAVAGOAT MULTI-BOT MANAGER");
    console.log("=".repeat(60));
    console.log(`📡 Firebase URL: ${FIREBASE_URL}\n`);
    
    if (!FIREBASE_URL) {
        console.error("❌ ERROR: FIREBASE_URL environment variable not set!");
        console.log("Please add FIREBASE_URL to GitHub Secrets");
        process.exit(1);
    }
    
    const restaurants = await fetchFromFirebase('restaurants');
    if (!restaurants) {
        console.log("❌ No restaurants found in database");
        console.log("Please add restaurants from the admin panel first.");
        return;
    }
    
    let botCount = 0;
    for (const [restId, restData] of Object.entries(restaurants)) {
        if (restData.status === 'active' && restData.whatsappNumber) {
            botCount++;
            console.log(`\n📱 [${botCount}] Starting bot for: ${restData.name}`);
            await createBotInstance(restId, restData);
            // Add delay between bot starts
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
    
    console.log("\n" + "=".repeat(60));
    console.log(`✅ Bot Manager Running!`);
    console.log(`📊 Active Bots: ${botCount}`);
    console.log("=".repeat(60));
    console.log("\n💡 Scan the QR codes above with WhatsApp to connect each bot");
    console.log("📱 Each restaurant needs to be connected separately\n");
}

// Keep the process alive
process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection:', reason);
});

// Start the bot manager
startAllBots().catch(console.error);
