const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const fetch = require('node-fetch');

// Firebase Configuration
const FIREBASE_URL = process.env.FIREBASE_URL;
const DELIVERY_FEE = 150;
const TAX_RATE = 0.05;

// Store user sessions
const userSessions = {};

// Order states
const ORDER_STATES = {
    IDLE: 'IDLE',
    BROWSING_MENU: 'BROWSING_MENU',
    ADDING_TO_CART: 'ADDING_TO_CART',
    VIEWING_CART: 'VIEWING_CART',
    CHECKOUT_ADDRESS: 'CHECKOUT_ADDRESS',
    CHECKOUT_NAME: 'CHECKOUT_NAME',
    CHECKOUT_PHONE: 'CHECKOUT_PHONE',
    CONFIRMING_ORDER: 'CONFIRMING_ORDER'
};

// Function to fetch menu from Firebase
async function getMenuFromApp() {
    try {
        const response = await fetch(`${FIREBASE_URL}/dishes.json`);
        const data = await response.json();
        if (!data) return [];
        
        return Object.keys(data).map(key => ({
            id: key,
            name: data[key].name,
            price: parseFloat(data[key].price),
            imageUrl: data[key].imageUrl
        }));
    } catch (error) {
        console.error("Failed to fetch menu:", error);
        return [];
    }
}

// Function to get user's orders
async function getUserOrders(waNumber) {
    try {
        const response = await fetch(`${FIREBASE_URL}/orders.json`);
        const data = await response.json();
        if (!data) return [];
        
        const orders = [];
        for (const [key, value] of Object.entries(data)) {
            if (value.userId === `whatsapp_${waNumber}` || value.userId === waNumber) {
                orders.push({ id: key, ...value });
            }
        }
        return orders.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    } catch (error) {
        console.error("Failed to fetch user orders:", error);
        return [];
    }
}

// Function to get order by ID
async function getOrderById(orderId) {
    try {
        const response = await fetch(`${FIREBASE_URL}/orders/${orderId}.json`);
        const order = await response.json();
        return order ? { id: orderId, ...order } : null;
    } catch (error) {
        console.error("Failed to fetch order:", error);
        return null;
    }
}

// Function to save order
async function saveOrder(orderData) {
    try {
        const response = await fetch(`${FIREBASE_URL}/orders.json`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(orderData)
        });
        const result = await response.json();
        return result.name;
    } catch (error) {
        console.error("Firebase Error: ", error);
        throw error;
    }
}

// Generate cart summary
function getCartSummary(cart) {
    if (!cart || cart.length === 0) return null;
    
    let subtotal = 0;
    let itemsList = '';
    
    cart.forEach((item, index) => {
        const itemTotal = item.price * item.quantity;
        subtotal += itemTotal;
        itemsList += `${index + 1}. ${item.name} x${item.quantity} = ₨${itemTotal}\n`;
    });
    
    const tax = subtotal * TAX_RATE;
    const total = subtotal + tax + DELIVERY_FEE;
    
    return {
        itemsList,
        subtotal,
        tax,
        deliveryFee: DELIVERY_FEE,
        total,
        itemCount: cart.reduce((sum, item) => sum + item.quantity, 0)
    };
}

// Format currency
function formatPKR(amount) {
    return `₨${amount.toFixed(2)}`;
}

// Get status emoji
function getStatusEmoji(status) {
    const emojis = {
        'Placed': '📋',
        'Preparing': '🔪',
        'Out for Delivery': '🚚',
        'Delivered': '✅',
        'Cancelled': '❌'
    };
    return emojis[status] || '📋';
}

// Create tracking visual
function createTrackingVisual(status) {
    const steps = ['Placed', 'Preparing', 'Out for Delivery', 'Delivered'];
    const currentIndex = steps.indexOf(status);
    
    let visual = '';
    for (let i = 0; i < steps.length; i++) {
        if (i < currentIndex) {
            visual += '✅';
        } else if (i === currentIndex && currentIndex !== -1) {
            visual += '📍';
        } else {
            visual += '⭕';
        }
        if (i < steps.length - 1) visual += '━━━';
    }
    return visual;
}

async function startBot() {
    if (!FIREBASE_URL) {
        console.log("❌ ERROR: FIREBASE_URL is missing in GitHub Secrets!");
        process.exit(1);
    }

    console.log("🚀 Starting JavaGoat WhatsApp Bot v2.0...");
    console.log(`📡 Firebase URL: ${FIREBASE_URL}`);

    const { state, saveCreds } = await useMultiFileAuthState('session_data');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ["JavaGoat", "Chrome", "2.0"]
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.clear();
            console.log('\n╔════════════════════════════════════════╗');
            console.log('║     📱 SCAN QR CODE WITH WHATSAPP       ║');
            console.log('╚════════════════════════════════════════╝\n');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'open') {
            console.log('✅ JAVAGOAT BOT IS ONLINE!');
            console.log('📱 Bot is ready to take orders!');
            console.log('💡 Commands: menu, order [item], cart, checkout, track, help');
        }
        
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            console.log(`❌ Connection closed. Reason: ${reason}`);
            if (reason !== DisconnectReason.loggedOut) {
                console.log('🔄 Reconnecting in 5 seconds...');
                setTimeout(startBot, 5000);
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;
        if (msg.key.fromMe) return;

        const sender = msg.key.remoteJid;
        const waNumber = sender.split('@')[0];
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim().toLowerCase();
        
        // Initialize session
        if (!userSessions[sender]) {
            userSessions[sender] = {
                cart: [],
                state: ORDER_STATES.IDLE,
                tempData: {}
            };
        }
        
        const session = userSessions[sender];
        
        console.log(`📩 [${waNumber}]: ${text}`);

        // ============ TRACK ORDER ============
        if (text === "track" || text === "my orders") {
            const userOrders = await getUserOrders(waNumber);
            
            if (userOrders.length === 0) {
                await sock.sendMessage(sender, { 
                    text: `📭 *No Orders Found*\n\nYou haven't placed any orders yet.\n\nType *menu* to see our delicious food options!` 
                });
                return;
            }
            
            let msg = `📋 *YOUR ORDERS* 📋\n\n`;
            msg += `Total Orders: ${userOrders.length}\n━━━━━━━━━━━━━━━━\n\n`;
            
            userOrders.slice(0, 5).forEach((order, idx) => {
                const date = new Date(order.timestamp).toLocaleDateString();
                msg += `${idx + 1}. *Order #${order.id.substring(0, 8)}*\n`;
                msg += `   ${getStatusEmoji(order.status)} Status: ${order.status}\n`;
                msg += `   📅 ${date}\n`;
                msg += `   💰 ${formatPKR(order.total)}\n━━━━━━━━━━━━━━━\n`;
            });
            
            msg += `\n_To track specific order: track ORDER_ID_\n`;
            msg += `_Example: track ${userOrders[0].id.substring(0, 8)}_`;
            
            await sock.sendMessage(sender, { text: msg });
            return;
        }
        
        if (text.startsWith("track ")) {
            let orderId = text.replace("track", "").trim();
            
            // Try to find order
            const userOrders = await getUserOrders(waNumber);
            let fullOrderId = orderId;
            
            if (orderId.length < 8) {
                const matched = userOrders.find(o => o.id.substring(0, 8).startsWith(orderId));
                if (matched) fullOrderId = matched.id;
            }
            
            const order = await getOrderById(fullOrderId);
            
            if (!order) {
                await sock.sendMessage(sender, { 
                    text: `❌ *Order Not Found*\n\nPlease check the order ID and try again.\nType *track* to see your orders.` 
                });
                return;
            }
            
            const trackingVisual = createTrackingVisual(order.status);
            const itemsList = order.items.map(item => 
                `   • ${item.name} x${item.quantity} = ${formatPKR(item.price * item.quantity)}`
            ).join('\n');
            
            const msg = `
╔════════════════════════════════╗
║        🚚 ORDER TRACKING        ║
╚════════════════════════════════╝

*Order ID:* #${order.id.substring(0, 8)}
*Date:* ${new Date(order.timestamp).toLocaleString()}

${trackingVisual}

*Status:* ${getStatusEmoji(order.status)} ${order.status}

*Items:*
${itemsList}

*Total:* ${formatPKR(order.total)}
*Payment:* ${order.method || 'Cash on Delivery'}

*Delivery Address:*
${order.address || 'Not specified'}

━━━━━━━━━━━━━━━━━━━━
_You'll receive automatic updates when status changes!_`;
            
            await sock.sendMessage(sender, { text: msg });
            return;
        }

        // ============ CHECKOUT ============
        if (session.state === ORDER_STATES.CHECKOUT_NAME) {
            session.tempData.name = text;
            session.state = ORDER_STATES.CHECKOUT_PHONE;
            await sock.sendMessage(sender, { 
                text: `📱 *Phone Number*\n\nPlease provide your phone number for delivery:\n\nExample: 03XX 1234567` 
            });
            return;
        }
        
        if (session.state === ORDER_STATES.CHECKOUT_PHONE) {
            session.tempData.phone = text;
            session.state = ORDER_STATES.CHECKOUT_ADDRESS;
            await sock.sendMessage(sender, { 
                text: `📍 *Delivery Address*\n\nPlease provide your complete delivery address:\n\nExample: House #123, Street 5, DHA, Karachi` 
            });
            return;
        }
        
        if (session.state === ORDER_STATES.CHECKOUT_ADDRESS) {
            session.tempData.address = text;
            session.state = ORDER_STATES.CONFIRMING_ORDER;
            
            const cartSummary = getCartSummary(session.cart);
            const confirmMsg = `
🛒 *ORDER SUMMARY*

${cartSummary.itemsList}

📊 *Bill Breakdown:*
Subtotal: ${formatPKR(cartSummary.subtotal)}
Tax (5%): ${formatPKR(cartSummary.tax)}
Delivery: ${formatPKR(DELIVERY_FEE)}
━━━━━━━━━━━━━━━━━━━━
*Total: ${formatPKR(cartSummary.total)}*

👤 *Delivery Details:*
Name: ${session.tempData.name}
Phone: ${session.tempData.phone}
Address: ${session.tempData.address}

━━━━━━━━━━━━━━━━━━━━
*Reply with:*
✅ *CONFIRM* - Place order
❌ *CANCEL* - Cancel order`;
            
            await sock.sendMessage(sender, { text: confirmMsg });
            return;
        }
        
        if (session.state === ORDER_STATES.CONFIRMING_ORDER) {
            if (text === "confirm") {
                const cartSummary = getCartSummary(session.cart);
                const orderItems = session.cart.map(item => ({
                    id: item.id,
                    name: item.name,
                    price: item.price,
                    quantity: item.quantity,
                    img: item.imageUrl || ""
                }));
                
                const newOrder = {
                    userId: `whatsapp_${waNumber}`,
                    userEmail: `${waNumber}@whatsapp.javagoat.com`,
                    customerName: session.tempData.name,
                    phone: session.tempData.phone,
                    address: session.tempData.address,
                    items: orderItems,
                    subtotal: cartSummary.subtotal,
                    tax: cartSummary.tax,
                    deliveryFee: DELIVERY_FEE,
                    total: cartSummary.total,
                    status: "Placed",
                    method: "Cash on Delivery",
                    timestamp: new Date().toISOString(),
                    source: "WhatsApp Bot"
                };
                
                try {
                    const savedOrderId = await saveOrder(newOrder);
                    
                    await sock.sendMessage(sender, { 
                        text: `✅ *ORDER CONFIRMED!* ✅\n\n*Order ID:* #${savedOrderId.substring(0, 8)}\n\n${cartSummary.itemsList}\n\n*Total:* ${formatPKR(cartSummary.total)}\n\n🚚 *Delivery to:* ${session.tempData.address}\n\nYou can track your order anytime with:\n*track ${savedOrderId.substring(0, 8)}*\n\nThank you for ordering from JavaGoat! 🍔` 
                    });
                    
                    // Reset session
                    userSessions[sender] = {
                        cart: [],
                        state: ORDER_STATES.IDLE,
                        tempData: {}
                    };
                    
                } catch (error) {
                    await sock.sendMessage(sender, { 
                        text: `❌ *Order Failed*\n\nError: ${error.message}\nPlease try again.` 
                    });
                }
                
            } else if (text === "cancel") {
                userSessions[sender] = {
                    cart: [],
                    state: ORDER_STATES.IDLE,
                    tempData: {}
                };
                await sock.sendMessage(sender, { 
                    text: `❌ *Order Cancelled*\n\nYour order has been cancelled. Type *menu* to start fresh.` 
                });
            } else {
                await sock.sendMessage(sender, { 
                    text: `Please reply with *CONFIRM* or *CANCEL*` 
                });
            }
            return;
        }

        // ============ SHOW CART ============
        if (text === "cart" || text === "view cart") {
            if (session.cart.length === 0) {
                await sock.sendMessage(sender, { 
                    text: `🛒 *Cart is empty*\n\nAdd items using:\n*order [item name]*\n\nType *menu* to see our food!` 
                });
                return;
            }
            
            const cartSummary = getCartSummary(session.cart);
            await sock.sendMessage(sender, { 
                text: `🛒 *YOUR CART* 🛒\n\n${cartSummary.itemsList}\n━━━━━━━━━━━━━━━━━━━━\n*Total: ${formatPKR(cartSummary.total)}*\n\nCommands:\n• *checkout* - Place order\n• *clear cart* - Empty cart\n• *remove [item]* - Remove item` 
            });
            return;
        }
        
        // ============ CLEAR CART ============
        if (text === "clear cart" || text === "empty cart") {
            session.cart = [];
            await sock.sendMessage(sender, { 
                text: `🗑️ *Cart Cleared*\n\nType *menu* to browse our food.` 
            });
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
                await sock.sendMessage(sender, { 
                    text: `🗑️ Removed *${removed.name}*\n\nType *cart* to see updated cart.` 
                });
            } else {
                await sock.sendMessage(sender, { 
                    text: `❌ Could not find "${itemToRemove}" in your cart.` 
                });
            }
            return;
        }
        
        // ============ CHECKOUT ============
        if (text === "checkout" || text === "place order") {
            if (session.cart.length === 0) {
                await sock.sendMessage(sender, { 
                    text: `🛒 *Cart is empty*\n\nAdd items first using *order [item name]*` 
                });
                return;
            }
            
            session.state = ORDER_STATES.CHECKOUT_NAME;
            await sock.sendMessage(sender, { 
                text: `👤 *Your Name*\n\nPlease provide your full name for delivery.` 
            });
            return;
        }
        
        // ============ ORDER ITEM ============
        if (text.startsWith("order ") || text.startsWith("buy ")) {
            const productRequested = text.replace(/^(order|buy) /, "").trim().toLowerCase();
            const currentMenu = await getMenuFromApp();
            
            const matchedItems = currentMenu.filter(item => 
                item.name.toLowerCase().includes(productRequested)
            );
            
            if (matchedItems.length === 0) {
                await sock.sendMessage(sender, { 
                    text: `❌ Sorry, couldn't find *${productRequested}*\n\nType *menu* to see all items.` 
                });
                return;
            }
            
            if (matchedItems.length > 1) {
                let optionsMsg = `🔍 Multiple items found:\n\n`;
                matchedItems.forEach((item, idx) => {
                    optionsMsg += `${idx + 1}. ${item.name} - ${formatPKR(item.price)}\n`;
                });
                optionsMsg += `\nReply with the number.`;
                
                session.state = ORDER_STATES.BROWSING_MENU;
                session.tempData.matchedItems = matchedItems;
                await sock.sendMessage(sender, { text: optionsMsg });
                return;
            }
            
            const item = matchedItems[0];
            session.state = ORDER_STATES.ADDING_TO_CART;
            session.tempData.selectedItem = item;
            
            const msg = `🛒 *${item.name}* - ${formatPKR(item.price)}\n\nReply with quantity (1-10):\n\nType *cancel* to cancel.`;
            
            if (item.imageUrl) {
                await sock.sendMessage(sender, { image: { url: item.imageUrl }, caption: msg });
            } else {
                await sock.sendMessage(sender, { text: msg });
            }
            return;
        }
        
        // Handle quantity
        if (session.state === ORDER_STATES.ADDING_TO_CART) {
            if (text === "cancel") {
                session.state = ORDER_STATES.IDLE;
                session.tempData = {};
                await sock.sendMessage(sender, { text: `❌ Cancelled.` });
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
            
            session.state = ORDER_STATES.IDLE;
            session.tempData = {};
            
            await sock.sendMessage(sender, { 
                text: `✅ Added ${quantity}x ${item.name} to cart!\n\nType *cart* to view or *checkout* to place order.` 
            });
            return;
        }
        
        // Handle multiple selection
        if (session.state === ORDER_STATES.BROWSING_MENU) {
            const selection = parseInt(text);
            const matchedItems = session.tempData.matchedItems;
            
            if (!isNaN(selection) && selection >= 1 && selection <= matchedItems.length) {
                const selected = matchedItems[selection - 1];
                session.state = ORDER_STATES.ADDING_TO_CART;
                session.tempData.selectedItem = selected;
                session.tempData.matchedItems = null;
                await sock.sendMessage(sender, { 
                    text: `Quantity for *${selected.name}* (1-10):` 
                });
            } else if (text === "cancel") {
                session.state = ORDER_STATES.IDLE;
                session.tempData = {};
                await sock.sendMessage(sender, { text: `Cancelled.` });
            } else {
                await sock.sendMessage(sender, { 
                    text: `Please reply with a number 1-${matchedItems.length}.` 
                });
            }
            return;
        }
        
        // ============ MENU ============
        if (text === "menu" || text === "food" || text === "dishes" || text === "list") {
            const currentMenu = await getMenuFromApp();
            
            if (currentMenu.length === 0) {
                await sock.sendMessage(sender, { text: "Menu is empty. Please check back soon!" });
                return;
            }
            
            let msg = "🍔 *JAVAGOAT MENU* 🍕\n\n";
            currentMenu.slice(0, 15).forEach((item, idx) => {
                msg += `${idx + 1}. *${item.name}* - ${formatPKR(item.price)}\n`;
            });
            msg += "\n📝 *To order:* `order [dish name]`\n";
            msg += "📦 *Track orders:* `track`\n";
            msg += "🛒 *View cart:* `cart`\n";
            msg += "✅ *Checkout:* `checkout`\n";
            msg += "❓ *Help:* `help`";
            
            await sock.sendMessage(sender, { text: msg });
            return;
        }
        
        // ============ HELP ============
        if (text === "help" || text === "commands") {
            const helpMsg = `
🤖 *JAVAGOAT BOT COMMANDS*

🛒 *Ordering:*
• *menu* - Show all food
• *order [item]* - Add to cart
• *cart* - View cart
• *remove [item]* - Remove from cart
• *clear cart* - Empty cart
• *checkout* - Place order

📦 *Tracking:*
• *track* - See your orders
• *track [ID]* - Track order

ℹ️ *General:*
• *help* - This menu
• *hi/hello* - Greeting

💡 *Examples:*
order biryani
track ORD_12345678
checkout

_Type *menu* to get started!_`;
            
            await sock.sendMessage(sender, { text: helpMsg });
            return;
        }
        
        // ============ GREETINGS ============
        if (text.match(/^(hi|hello|hey|start)$/i)) {
            await sock.sendMessage(sender, { 
                text: `👋 *Welcome to JavaGoat!*\n\nType *menu* to see our food, or *help* for all commands.\n\n*Quick start:*\n1. Type *menu*\n2. Type *order biryani*\n3. Type *checkout*` 
            });
            return;
        }
        
        // ============ CONTACT ============
        if (text.includes("contact") || text.includes("support")) {
            await sock.sendMessage(sender, { 
                text: `📞 *Contact Support*\n\nEmail: support@javagoat.com\n\nFor order issues, please share your order ID.` 
            });
            return;
        }
        
        // ============ DEFAULT ============
        if (session.state === ORDER_STATES.IDLE) {
            await sock.sendMessage(sender, { 
                text: `🤔 I didn't understand.\n\nType *help* for commands or *menu* to see food.` 
            });
        }
    });
}

// Handle errors
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

startBot().catch(err => console.log("Fatal Error: " + err));
