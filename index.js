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
const activeOrderWatchers = {};

// Order states
const ORDER_STATES = {
    IDLE: 'IDLE',
    BROWSING_MENU: 'BROWSING_MENU',
    ADDING_TO_CART: 'ADDING_TO_CART',
    CHECKOUT_NAME: 'CHECKOUT_NAME',
    CHECKOUT_PHONE: 'CHECKOUT_PHONE',
    CHECKOUT_ADDRESS: 'CHECKOUT_ADDRESS',
    CONFIRMING_ORDER: 'CONFIRMING_ORDER'
};

// Helper function to ensure number
function toNumber(value) {
    if (value === undefined || value === null) return 0;
    const num = parseFloat(value);
    return isNaN(num) ? 0 : num;
}

// Format currency
function formatPKR(amount) {
    const numAmount = toNumber(amount);
    return `₨${numAmount.toFixed(2)}`;
}

// Get status emoji and message
function getStatusInfo(status) {
    const statusMap = {
        'Placed': { emoji: '📋', message: '✅ Order placed and confirmed', color: '🟡' },
        'Preparing': { emoji: '🔪', message: '👨‍🍳 Restaurant is preparing your food', color: '🔵' },
        'Out for Delivery': { emoji: '🚚', message: '🏍️ Rider is on the way with your order', color: '🟣' },
        'Delivered': { emoji: '✅', message: '🎉 Order delivered successfully! Enjoy your meal!', color: '🟢' },
        'Cancelled': { emoji: '❌', message: '⚠️ Order was cancelled', color: '🔴' }
    };
    return statusMap[status] || { emoji: '📋', message: 'Order received', color: '⚪' };
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

// Function to fetch menu from Firebase
async function getMenuFromApp() {
    try {
        const response = await fetch(`${FIREBASE_URL}/dishes.json`);
        const data = await response.json();
        if (!data) return [];
        
        return Object.keys(data).map(key => ({
            id: key,
            name: data[key].name || "Unknown",
            price: toNumber(data[key].price),
            imageUrl: data[key].imageUrl || ""
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
            // Match by userId or phone number
            if (value.userId === `whatsapp_${waNumber}` || 
                value.userId === waNumber || 
                value.phone === waNumber ||
                (value.userId && value.userId.includes(waNumber))) {
                orders.push({ 
                    id: key, 
                    ...value,
                    total: toNumber(value.total),
                    subtotal: toNumber(value.subtotal)
                });
            }
        }
        return orders.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    } catch (error) {
        console.error("Failed to fetch user orders:", error);
        return [];
    }
}

// Function to get order by ID - FIXED
async function getOrderById(orderId) {
    try {
        // First try direct fetch
        let response = await fetch(`${FIREBASE_URL}/orders/${orderId}.json`);
        let order = await response.json();
        
        if (order) {
            return { 
                id: orderId, 
                ...order,
                total: toNumber(order.total),
                subtotal: toNumber(order.subtotal)
            };
        }
        
        // If not found, search through all orders
        response = await fetch(`${FIREBASE_URL}/orders.json`);
        const allOrders = await response.json();
        
        if (allOrders) {
            for (const [key, value] of Object.entries(allOrders)) {
                // Match by full ID or partial ID (first 8 chars)
                if (key === orderId || key.substring(0, 8) === orderId.substring(0, 8)) {
                    return { 
                        id: key, 
                        ...value,
                        total: toNumber(value.total),
                        subtotal: toNumber(value.subtotal)
                    };
                }
            }
        }
        
        return null;
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

// Watch order status and send updates
async function watchOrderStatus(orderId, waNumber, sock) {
    const watcherKey = `${orderId}_${waNumber}`;
    if (activeOrderWatchers[watcherKey]) return;
    
    activeOrderWatchers[watcherKey] = true;
    let lastStatus = '';
    
    const checkInterval = setInterval(async () => {
        try {
            const order = await getOrderById(orderId);
            if (order && order.status !== lastStatus) {
                lastStatus = order.status;
                const statusInfo = getStatusInfo(order.status);
                const trackingVisual = createTrackingVisual(order.status);
                
                const updateMsg = `
╔════════════════════════════════╗
║     📦 ORDER STATUS UPDATE      ║
╚════════════════════════════════╝

*Order ID:* #${orderId.substring(0, 8)}
${trackingVisual}

*Status:* ${statusInfo.emoji} ${order.status}
${statusInfo.message}

*Total:* ${formatPKR(order.total)}

_Type *track ${orderId.substring(0, 8)}* for full details_`;
                
                await sock.sendMessage(waNumber, { text: updateMsg });
                
                if (order.status === 'Delivered' || order.status === 'Cancelled') {
                    clearInterval(checkInterval);
                    delete activeOrderWatchers[watcherKey];
                }
            }
        } catch (error) {
            console.error("Status check error:", error);
        }
    }, 30000);
}

// Generate cart summary
function getCartSummary(cart) {
    if (!cart || cart.length === 0) return null;
    
    let subtotal = 0;
    let itemsList = '';
    
    cart.forEach((item, index) => {
        const price = toNumber(item.price);
        const quantity = toNumber(item.quantity);
        const itemTotal = price * quantity;
        subtotal += itemTotal;
        itemsList += `${index + 1}. ${item.name} x${quantity} = ${formatPKR(itemTotal)}\n`;
    });
    
    const tax = subtotal * TAX_RATE;
    const total = subtotal + tax + DELIVERY_FEE;
    
    return {
        itemsList,
        subtotal,
        tax,
        deliveryFee: DELIVERY_FEE,
        total,
        itemCount: cart.reduce((sum, item) => sum + toNumber(item.quantity), 0)
    };
}

async function startBot() {
    if (!FIREBASE_URL) {
        console.log("❌ ERROR: FIREBASE_URL is missing in GitHub Secrets!");
        process.exit(1);
    }

    console.log("🚀 Starting JavaGoat WhatsApp Bot v3.0...");
    console.log("📦 Multi-item orders supported!");
    console.log("🔍 Order tracking by ID working!");

    const { state, saveCreds } = await useMultiFileAuthState('session_data');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ["JavaGoat", "Chrome", "3.0"]
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
            console.log('🍕 Multi-item orders: Just keep adding items before checkout!');
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

        // ============ TRACK ORDER - FIXED ============
        if (text === "track" || text === "my orders" || text === "orders") {
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
                const statusInfo = getStatusInfo(order.status);
                const shortId = order.id.substring(0, 8);
                msg += `${idx + 1}. *Order #${shortId}*\n`;
                msg += `   ${statusInfo.emoji} Status: ${order.status}\n`;
                msg += `   📅 ${date}\n`;
                msg += `   💰 ${formatPKR(order.total)}\n`;
                msg += `   🍽️ Items: ${order.items ? order.items.length : 0}\n`;
                msg += `   ━━━━━━━━━━━━━━━\n`;
            });
        
            msg += `\n📝 *To track an order:*\n`;
            msg += `Type: *track ORDER_ID*\n`;
            msg += `Example: *track ${userOrders[0].id.substring(0, 8)}*\n\n`;
            msg += `💡 *Tip:* You can use the full Order ID or just the first 8 characters!`;
        
            await sock.sendMessage(sender, { text: msg });
            return;
        }
        
        // FIXED: Track by order ID - works with partial IDs
        if (text.startsWith("track ")) {
            let orderIdInput = text.replace("track", "").trim();
            // Remove any special characters
            orderIdInput = orderIdInput.replace(/[^a-zA-Z0-9_-]/g, '');
            
            console.log(`🔍 Looking for order: ${orderIdInput}`);
            
            // Get all user orders first
            const userOrders = await getUserOrders(waNumber);
            
            if (userOrders.length === 0) {
                await sock.sendMessage(sender, { 
                    text: `📭 *No Orders Found*\n\nYou haven't placed any orders yet.\n\nType *menu* to order something first!` 
                });
                return;
            }
            
            // Try to find matching order
            let matchedOrder = null;
            
            // First try exact match
            for (const order of userOrders) {
                if (order.id === orderIdInput) {
                    matchedOrder = order;
                    break;
                }
            }
            
            // If not found, try partial match (first 8 characters)
            if (!matchedOrder) {
                for (const order of userOrders) {
                    const shortId = order.id.substring(0, 8);
                    if (shortId === orderIdInput || order.id.includes(orderIdInput)) {
                        matchedOrder = order;
                        break;
                    }
                }
            }
            
            // If still not found, try searching all orders in Firebase
            if (!matchedOrder) {
                const allOrders = await getOrderById(orderIdInput);
                if (allOrders && allOrders.phone === waNumber) {
                    matchedOrder = allOrders;
                }
            }
            
            if (!matchedOrder) {
                // Show available order IDs to help user
                const availableIds = userOrders.slice(0, 3).map(o => `• #${o.id.substring(0, 8)}`).join('\n');
                await sock.sendMessage(sender, { 
                    text: `❌ *Order Not Found*\n\nCould not find order with ID: "${orderIdInput}"\n\n📋 *Your recent orders:*\n${availableIds}\n\n💡 *Tip:* Try using:\n• *track* - See all your orders\n• *track [order_id]* - Use the ID shown above` 
                });
                return;
            }
            
            const order = matchedOrder;
            const statusInfo = getStatusInfo(order.status);
            const trackingVisual = createTrackingVisual(order.status);
            
            const itemsList = order.items ? order.items.map(item => 
                `   • ${item.name} x${item.quantity} = ${formatPKR(toNumber(item.price) * toNumber(item.quantity))}`
            ).join('\n') : '   No items found';
            
            const msg = `
╔════════════════════════════════╗
║        🚚 ORDER TRACKING        ║
╚════════════════════════════════╝

*Order ID:* #${order.id.substring(0, 8)}
*Date:* ${new Date(order.timestamp).toLocaleString()}

${trackingVisual}

*Status:* ${statusInfo.emoji} ${order.status}
${statusInfo.message}

*Items:*
${itemsList}

*Total:* ${formatPKR(order.total)}
*Payment:* ${order.method || 'Cash on Delivery'}

*Delivery Address:*
${order.address || 'Not specified'}

━━━━━━━━━━━━━━━━━━━━
_You'll receive automatic updates when status changes!_`;
            
            await sock.sendMessage(sender, { text: msg });
            
            // Start watching this order for updates
            await watchOrderStatus(order.id, sender, sock);
            return;
        }

        // ============ SHOW CART (Multi-item support) ============
        if (text === "cart" || text === "view cart" || text === "my cart") {
            if (session.cart.length === 0) {
                await sock.sendMessage(sender, { 
                    text: `🛒 *Your cart is empty*

Add items using:
• *order pizza*
• *order biryani*
• *order kabab*

You can add MULTIPLE items before checkout!

Type *menu* to see all items.` 
                });
                return;
            }
            
            const cartSummary = getCartSummary(session.cart);
            let cartMsg = `🛒 *YOUR CART* 🛒\n\n`;
            cartMsg += `${cartSummary.itemsList}\n`;
            cartMsg += `━━━━━━━━━━━━━━━━━━━━\n`;
            cartMsg += `📊 *Subtotal:* ${formatPKR(cartSummary.subtotal)}\n`;
            cartMsg += `📊 *Tax (5%):* ${formatPKR(cartSummary.tax)}\n`;
            cartMsg += `🚚 *Delivery:* ${formatPKR(DELIVERY_FEE)}\n`;
            cartMsg += `━━━━━━━━━━━━━━━━━━━━\n`;
            cartMsg += `💰 *TOTAL: ${formatPKR(cartSummary.total)}*\n\n`;
            cartMsg += `📦 *Total Items:* ${cartSummary.itemCount}\n\n`;
            cartMsg += `✨ *What now?*\n`;
            cartMsg += `• *order [item]* - Add more items\n`;
            cartMsg += `• *checkout* - Place order\n`;
            cartMsg += `• *remove [item]* - Remove item\n`;
            cartMsg += `• *clear cart* - Empty cart`;
            
            await sock.sendMessage(sender, { text: cartMsg });
            return;
        }
        
        // ============ CLEAR CART ============
        if (text === "clear cart" || text === "empty cart") {
            session.cart = [];
            await sock.sendMessage(sender, { 
                text: `🗑️ *Cart Cleared*\n\nYour cart is now empty.\n\nType *menu* to browse our food and start fresh!` 
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
                const cartSummary = getCartSummary(session.cart);
                await sock.sendMessage(sender, { 
                    text: `🗑️ *Removed* ${removed.name}

📊 *New Cart Total:* ${cartSummary ? formatPKR(cartSummary.total) : '₨0'}

Type *cart* to see updated cart.` 
                });
            } else {
                await sock.sendMessage(sender, { 
                    text: `❌ Could not find "${itemToRemove}" in your cart.

Type *cart* to see what's inside.

💡 *Tip:* Try *remove biryani* or *remove pizza*` 
                });
            }
            return;
        }
        
        // ============ CHECKOUT ============
        if (text === "checkout" || text === "place order" || text === "order now") {
            if (session.cart.length === 0) {
                await sock.sendMessage(sender, { 
                    text: `🛒 *Cart is empty*

You need to add items first!

1. Type *menu* to see items
2. Type *order pizza* to add
3. Add MULTIPLE items
4. Then *checkout*

Example: 
• order biryani
• order kabab  
• order pizza
• checkout` 
                });
                return;
            }
            
            const cartSummary = getCartSummary(session.cart);
            session.state = ORDER_STATES.CHECKOUT_NAME;
            await sock.sendMessage(sender, { 
                text: `👤 *Your Name*

You have ${cartSummary.itemCount} item(s) in cart.
Total: ${formatPKR(cartSummary.total)}

Please provide your full name for delivery.

Example: Muhammad Ali` 
            });
            return;
        }
        
        // ============ CHECKOUT FLOW ============
        if (session.state === ORDER_STATES.CHECKOUT_NAME) {
            session.tempData.name = text;
            session.state = ORDER_STATES.CHECKOUT_PHONE;
            await sock.sendMessage(sender, { 
                text: `📱 *Phone Number*

Please provide your phone number for delivery coordination.

Example: 03XX 1234567

_We'll only use this for delivery updates_` 
            });
            return;
        }
        
        if (session.state === ORDER_STATES.CHECKOUT_PHONE) {
            session.tempData.phone = text;
            session.state = ORDER_STATES.CHECKOUT_ADDRESS;
            await sock.sendMessage(sender, { 
                text: `📍 *Delivery Address*

Please provide your complete delivery address:

Example: House #123, Street 5, DHA Phase 2, Karachi

_Include landmark for easy finding_` 
            });
            return;
        }
        
        if (session.state === ORDER_STATES.CHECKOUT_ADDRESS) {
            session.tempData.address = text;
            session.state = ORDER_STATES.CONFIRMING_ORDER;
            
            const cartSummary = getCartSummary(session.cart);
            const confirmMsg = `
╔════════════════════════════════╗
║        🛒 ORDER SUMMARY         ║
╚════════════════════════════════╝

${cartSummary.itemsList}

📊 *Bill Breakdown:*
Subtotal: ${formatPKR(cartSummary.subtotal)}
Tax (5%): ${formatPKR(cartSummary.tax)}
Delivery: ${formatPKR(DELIVERY_FEE)}
━━━━━━━━━━━━━━━━━━━━
*TOTAL: ${formatPKR(cartSummary.total)}*

👤 *Delivery Details:*
Name: ${session.tempData.name}
Phone: ${session.tempData.phone}
Address: ${session.tempData.address}

━━━━━━━━━━━━━━━━━━━━
*Reply with:*
✅ *CONFIRM* - Place order
❌ *CANCEL* - Cancel order

_You can track your order after placing!_`;
            
            await sock.sendMessage(sender, { text: confirmMsg });
            return;
        }
        
        if (session.state === ORDER_STATES.CONFIRMING_ORDER) {
            if (text === "confirm") {
                const cartSummary = getCartSummary(session.cart);
                
                const orderItems = session.cart.map(item => ({
                    id: item.id,
                    name: item.name,
                    price: toNumber(item.price),
                    quantity: toNumber(item.quantity),
                    img: item.imageUrl || ""
                }));
                
                // Generate a readable order ID
                const timestamp = Date.now();
                const shortId = timestamp.toString().slice(-8);
                
                const newOrder = {
                    orderId: `ORD_${shortId}`,
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
                    timestampMs: timestamp,
                    source: "WhatsApp Bot"
                };
                
                try {
                    const savedOrderId = await saveOrder(newOrder);
                    const displayId = savedOrderId.substring(0, 8);
                    
                    const trackingVisual = createTrackingVisual('Placed');
                    
                    await sock.sendMessage(sender, { 
                        text: `✅ *ORDER CONFIRMED!* ✅

*Order ID:* #${displayId}

${cartSummary.itemsList}

📊 *Total Amount:* ${formatPKR(cartSummary.total)}

${trackingVisual}
*Status:* 📋 Placed

🚚 *Delivery Details:*
📍 ${session.tempData.address}
📞 ${session.tempData.phone}

━━━━━━━━━━━━━━━━━━━━
*📦 To track your order:*
Type: *track ${displayId}*

You'll also receive automatic updates when your order status changes!

Thank you for ordering from JavaGoat! 🍔

_Type *menu* to order more items!_` 
                    });
                    
                    // Start tracking this order
                    await watchOrderStatus(savedOrderId, sender, sock);
                    
                    // Reset session but keep cart empty
                    userSessions[sender] = {
                        cart: [],
                        state: ORDER_STATES.IDLE,
                        tempData: {}
                    };
                    
                } catch (error) {
                    console.error("Order save error:", error);
                    await sock.sendMessage(sender, { 
                        text: `❌ *Order Failed*

Error: ${error.message}

Please try again or contact support.

Type *menu* to start over.` 
                    });
                }
                
            } else if (text === "cancel") {
                userSessions[sender] = {
                    cart: [],
                    state: ORDER_STATES.IDLE,
                    tempData: {}
                };
                await sock.sendMessage(sender, { 
                    text: `❌ *Order Cancelled*

Your order has been cancelled.

Type *cart* to see your items or *menu* to start fresh.` 
                });
            } else {
                await sock.sendMessage(sender, { 
                    text: `Please reply with *CONFIRM* to place your order or *CANCEL* to cancel.` 
                });
            }
            return;
        }

        // ============ ADD MULTIPLE ITEMS TO CART ============
        if (text.startsWith("order ") || text.startsWith("buy ")) {
            const productRequested = text.replace(/^(order|buy) /, "").trim().toLowerCase();
            const currentMenu = await getMenuFromApp();
            
            if (currentMenu.length === 0) {
                await sock.sendMessage(sender, { 
                    text: `❌ Menu is currently empty. Please check back later!` 
                });
                return;
            }
            
            const matchedItems = currentMenu.filter(item => 
                item.name.toLowerCase().includes(productRequested)
            );
            
            if (matchedItems.length === 0) {
                // Show suggestions
                const suggestions = currentMenu.slice(0, 5).map(i => i.name).join(', ');
                await sock.sendMessage(sender, { 
                    text: `❌ Sorry, couldn't find *${productRequested}*

📋 *Available items:* ${suggestions}

Type *menu* to see full menu.

💡 *Tip:* Try "biryani" instead of "chicken biryani"` 
                });
                return;
            }
            
            if (matchedItems.length > 1) {
                let optionsMsg = `🔍 *Multiple items found for "${productRequested}"*

Please reply with the number:

`;
                matchedItems.forEach((item, idx) => {
                    optionsMsg += `${idx + 1}. ${item.name} - ${formatPKR(item.price)}\n`;
                });
                optionsMsg += `\nOr type *cancel* to cancel.`;
                
                session.state = ORDER_STATES.BROWSING_MENU;
                session.tempData.matchedItems = matchedItems;
                await sock.sendMessage(sender, { text: optionsMsg });
                return;
            }
            
            const item = matchedItems[0];
            session.state = ORDER_STATES.ADDING_TO_CART;
            session.tempData.selectedItem = item;
            
            const currentCartCount = session.cart.length;
            const cartHint = currentCartCount > 0 ? `\n\n📦 You already have ${currentCartCount} item(s) in cart.` : '';
            
            const msg = `🛒 *${item.name}* - ${formatPKR(item.price)}

Reply with quantity (1-10):

Type *cancel* to cancel.${cartHint}

💡 *Tip:* You can add multiple items before checking out!`;
            
            if (item.imageUrl && item.imageUrl.startsWith('http')) {
                await sock.sendMessage(sender, { image: { url: item.imageUrl }, caption: msg });
            } else {
                await sock.sendMessage(sender, { text: msg });
            }
            return;
        }
        
        // Handle quantity input
        if (session.state === ORDER_STATES.ADDING_TO_CART) {
            if (text === "cancel") {
                session.state = ORDER_STATES.IDLE;
                session.tempData = {};
                await sock.sendMessage(sender, { text: `❌ Cancelled.` });
                return;
            }
            
            const quantity = parseInt(text);
            if (isNaN(quantity) || quantity < 1 || quantity > 10) {
                await sock.sendMessage(sender, { text: `❌ Invalid quantity. Please enter a number between 1 and 10.` });
                return;
            }
            
            const item = session.tempData.selectedItem;
            const existing = session.cart.find(i => i.id === item.id);
            if (existing) {
                existing.quantity = toNumber(existing.quantity) + quantity;
            } else {
                session.cart.push({
                    id: item.id,
                    name: item.name,
                    price: toNumber(item.price),
                    quantity: quantity,
                    imageUrl: item.imageUrl
                });
            }
            
            const cartSummary = getCartSummary(session.cart);
            session.state = ORDER_STATES.IDLE;
            session.tempData = {};
            
            const continueMsg = `
✅ *Added to Cart!*

${quantity}x ${item.name} added.

📊 *Cart Summary:*
• Total Items: ${cartSummary.itemCount}
• Subtotal: ${formatPKR(cartSummary.subtotal)}
• Total with delivery: ${formatPKR(cartSummary.total)}

✨ *What would you like to do next?*
• *order [item]* - Add more items
• *cart* - View full cart
• *checkout* - Place order
• *menu* - See all items

💡 *You can add as many items as you want before checkout!*`;
            
            await sock.sendMessage(sender, { text: continueMsg });
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
                    text: `Quantity for *${selected.name}* (1-10):\n\nType *cancel* to cancel.` 
                });
            } else if (text === "cancel") {
                session.state = ORDER_STATES.IDLE;
                session.tempData = {};
                await sock.sendMessage(sender, { text: `❌ Cancelled.` });
            } else {
                await sock.sendMessage(sender, { 
                    text: `Please reply with a number between 1 and ${matchedItems.length}.` 
                });
            }
            return;
        }
        
        // ============ MENU ============
        if (text === "menu" || text === "food" || text === "dishes" || text === "list" || text === "items") {
            const currentMenu = await getMenuFromApp();
            
            if (currentMenu.length === 0) {
                await sock.sendMessage(sender, { text: "🍽️ *Menu is empty*\n\nPlease check back soon! Our menu is being updated." });
                return;
            }
            
            let msg = "🍔 *JAVAGOAT MENU* 🍕\n\n";
            msg += "━━━━━━━━━━━━━━━━━━━━\n";
            currentMenu.slice(0, 15).forEach((item, idx) => {
                msg += `${idx + 1}. *${item.name}*\n`;
                msg += `   💰 ${formatPKR(item.price)}\n`;
                msg += `   ━━━━━━━━━━━━━━━\n`;
            });
            
            if (currentMenu.length > 15) {
                msg += `\n_And ${currentMenu.length - 15} more items..._\n`;
            }
            
            msg += `\n📝 *How to order multiple items:*\n`;
            msg += `1. Type *order biryani*\n`;
            msg += `2. Choose quantity\n`;
            msg += `3. Type *order pizza* (add another)\n`;
            msg += `4. Type *cart* to review\n`;
            msg += `5. Type *checkout* when done\n\n`;
            
            msg += `✨ *Commands:*\n`;
            msg += `• *cart* - View your cart\n`;
            msg += `• *checkout* - Place order\n`;
            msg += `• *track* - Track your orders\n`;
            msg += `• *remove [item]* - Remove from cart\n`;
            msg += `• *clear cart* - Empty cart\n`;
            msg += `• *help* - All commands\n\n`;
            
            msg += `💡 *You can add MULTIPLE items before checking out!*`;
            
            await sock.sendMessage(sender, { text: msg });
            return;
        }
        
        // ============ HELP ============
        if (text === "help" || text === "commands" || text === "?") {
            const helpMsg = `
╔════════════════════════════════╗
║     🤖 JAVAGOAT BOT COMMANDS    ║
╚════════════════════════════════╝

🛒 *Ordering (Multi-item support):*
• *menu* - See all food items
• *order [item]* - Add to cart
• *order pizza* - Example
• *order biryani* - Example
• *cart* - View your cart
• *remove [item]* - Remove from cart
• *clear cart* - Empty cart
• *checkout* - Place order

📦 *Order Tracking:*
• *track* - See all your orders
• *track [ID]* - Track specific order

ℹ️ *General:*
• *help* - Show this menu
• *hi/hello* - Greeting
• *contact* - Support info

💡 *How to order multiple items:*

1️⃣ *Add first item:*
   order biryani
   → Choose quantity (e.g., 2)

2️⃣ *Add second item:*
   order pizza
   → Choose quantity (e.g., 1)

3️⃣ *Add more items:*
   order kabab
   → Choose quantity

4️⃣ *Review cart:*
   cart

5️⃣ *Place order:*
   checkout

━━━━━━━━━━━━━━━━━━━━
*Tracking example:*
track ORD_12345678

_You'll receive automatic updates for all your orders!_`;
            
            await sock.sendMessage(sender, { text: helpMsg });
            return;
        }
        
        // ============ GREETINGS ============
        if (text.match(/^(hi|hello|hey|start|greetings)$/i)) {
            await sock.sendMessage(sender, { 
                text: `👋 *Welcome to JavaGoat!* 🐐

Your favorite food delivery service is here!

🍕 *How to order MULTIPLE items:*

1️⃣ *Add items one by one:*
   • order biryani
   • order pizza
   • order kabab

2️⃣ *Review cart:* cart

3️⃣ *Place order:* checkout

📦 *Track orders:* track

💡 *Quick Example:*
> order biryani
> 2
> order pizza
> 1
> cart
> checkout

_What would you like to order today?_` 
            });
            return;
        }
        
        // ============ CONTACT ============
        if (text.includes("contact") || text.includes("support")) {
            await sock.sendMessage(sender, { 
                text: `📞 *Contact JavaGoat Support*

💬 *WhatsApp Support:* +92 329 5090465
📧 *Email:* support@javagoat.com
⏰ *Hours:* 10 AM - 10 PM (Daily)

*Quick Links:*
• Order issues: support@javagoat.com
• Delivery tracking: track [order_id]
• Feedback: feedback@javagoat.com

_We typically respond within 15 minutes!_` 
            });
            return;
        }
        
        // ============ DEFAULT ============
        if (session.state === ORDER_STATES.IDLE) {
            await sock.sendMessage(sender, { 
                text: `🤔 *I didn't quite understand that.*

📋 *Available Commands:*
• *menu* - View our food menu
• *order [food]* - Add to cart
• *cart* - View cart
• *checkout* - Place order
• *track* - Track orders
• *help* - All commands

💡 *Example:* order biryani

_You can add MULTIPLE items before checkout!_` 
            });
        }
    });
}

// Error handlers
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

startBot().catch(err => console.log("Fatal Error: " + err));
