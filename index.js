const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');

// Firebase Configuration
const FIREBASE_URL = process.env.FIREBASE_URL;
const DELIVERY_FEE = 150; // PKR Delivery Fee
const TAX_RATE = 0.05; // 5% Tax

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
    CONFIRMING_ORDER: 'CONFIRMING_ORDER',
    TRACKING_ORDER: 'TRACKING_ORDER'
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
        const response = await fetch(`${FIREBASE_URL}/orders.json?orderBy="userId"&equalTo="whatsapp_${waNumber}"`);
        const data = await response.json();
        if (!data) return [];
        
        return Object.keys(data).map(key => ({
            id: key,
            ...data[key]
        })).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
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

// Function to save order to Firebase
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

// Function to send notification
async function sendNotification(userId, title, body) {
    try {
        await fetch(`${FIREBASE_URL}/notifications/${userId}.json`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: title,
                body: body,
                timestamp: Date.now(),
                read: false
            })
        });
    } catch (error) {
        console.error("Notification Error:", error);
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

// Create order tracking visual
function createTrackingVisual(status) {
    const steps = ['Placed', 'Preparing', 'Out for Delivery', 'Delivered'];
    const currentIndex = steps.indexOf(status);
    
    let visual = '';
    for (let i = 0; i < steps.length; i++) {
        if (i < currentIndex) {
            visual += '✅';
        } else if (i === currentIndex) {
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
        console.log("❌ ERROR: FIREBASE_URL is missing in environment variables!");
        process.exit(1);
    }

    const { state, saveCreds } = await useMultiFileAuthState('session_data');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ["JavaGoatBot", "Chrome", "2.0"]
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
            console.log('📱 Bot is ready to take orders and track deliveries!');
        }
        
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) {
                console.log('🔄 Reconnecting...');
                startBot();
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // Listen for order status changes and send updates
    const orderStatusListener = {};
    
    async function watchOrderStatus(orderId, waNumber, sock) {
        if (orderStatusListener[orderId]) return;
        
        orderStatusListener[orderId] = true;
        const orderRef = `${FIREBASE_URL}/orders/${orderId}.json`;
        
        let lastStatus = '';
        
        const interval = setInterval(async () => {
            try {
                const response = await fetch(orderRef);
                const order = await response.json();
                
                if (order && order.status !== lastStatus) {
                    lastStatus = order.status;
                    const statusInfo = getStatusInfo(order.status);
                    const trackingVisual = createTrackingVisual(order.status);
                    
                    const statusUpdateMsg = `
╔════════════════════════════════╗
║     📦 ORDER STATUS UPDATE      ║
╚════════════════════════════════╝

*Order ID:* #${orderId.substring(0, 8)}
${trackingVisual}

*Status:* ${statusInfo.emoji} ${order.status}
${statusInfo.message}

*Items:* ${order.items.map(i => `${i.quantity}x ${i.name}`).join(', ')}
*Total:* ${formatPKR(order.total)}

_You can always check status by typing:_
*track ${orderId.substring(0, 8)}*
                    `;
                    
                    await sock.sendMessage(waNumber, { text: statusUpdateMsg });
                    
                    // If order is delivered, clear the interval
                    if (order.status === 'Delivered') {
                        clearInterval(interval);
                        delete orderStatusListener[orderId];
                    }
                }
            } catch (error) {
                console.error("Status check error:", error);
            }
        }, 30000); // Check every 30 seconds
    }

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;
        if (msg.key.fromMe) return;

        const sender = msg.key.remoteJid;
        const waNumber = sender.split('@')[0];
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim().toLowerCase();
        
        // Initialize user session
        if (!userSessions[sender]) {
            userSessions[sender] = {
                cart: [],
                state: ORDER_STATES.IDLE,
                tempData: {}
            };
        }
        
        const session = userSessions[sender];
        
        console.log(`📩 [${waNumber}]: ${text}`);

        // ============ ORDER TRACKING FEATURE ============
        if (text === "track" || text === "tracking" || text === "my orders") {
            const userOrders = await getUserOrders(waNumber);
            
            if (userOrders.length === 0) {
                await sock.sendMessage(sender, { 
                    text: `📭 *No Orders Found*

You haven't placed any orders yet.

Type *menu* to see our delicious food options!

💡 *Quick tip:* Type *help* for all commands` 
                });
                return;
            }
            
            let recentOrdersMsg = `📋 *YOUR ORDERS* 📋\n\n`;
            recentOrdersMsg += `Total Orders: ${userOrders.length}\n━━━━━━━━━━━━━━━━\n\n`;
            
            userOrders.slice(0, 5).forEach((order, idx) => {
                const statusInfo = getStatusInfo(order.status);
                const date = new Date(order.timestamp).toLocaleDateString();
                const time = new Date(order.timestamp).toLocaleTimeString();
                
                recentOrdersMsg += `${idx + 1}. *Order #${order.id.substring(0, 8)}*\n`;
                recentOrdersMsg += `   ${statusInfo.emoji} Status: ${order.status}\n`;
                recentOrdersMsg += `   📅 ${date} at ${time}\n`;
                recentOrdersMsg += `   🍽️ Items: ${order.items.length}\n`;
                recentOrdersMsg += `   💰 Total: ${formatPKR(order.total)}\n`;
                recentOrdersMsg += `   ━━━━━━━━━━━━━━━━\n\n`;
            });
            
            recentOrdersMsg += `_To track a specific order, type:_\n*track ORDER_ID_\n\n`;
            recentOrdersMsg += `_Example: track ${userOrders[0].id.substring(0, 8)}_\n\n`;
            recentOrdersMsg += `💡 *Tip:* You'll receive automatic updates when your order status changes!`;
            
            await sock.sendMessage(sender, { text: recentOrdersMsg });
            return;
        }
        
        if (text.startsWith("track ")) {
            let orderId = text.replace("track", "").trim();
            
            // Try to find order if partial ID is given
            if (orderId.length < 8) {
                const userOrders = await getUserOrders(waNumber);
                const matchedOrder = userOrders.find(o => o.id.substring(0, 8).startsWith(orderId));
                if (matchedOrder) {
                    orderId = matchedOrder.id;
                }
            }
            
            const order = await getOrderById(orderId);
            
            if (!order) {
                await sock.sendMessage(sender, { 
                    text: `❌ *Order Not Found*

Please check the order ID and try again.

Type *track* to see your recent orders with their IDs.` 
                });
                return;
            }
            
            // Verify order belongs to this user
            if (order.userId !== `whatsapp_${waNumber}` && order.userId !== waNumber) {
                await sock.sendMessage(sender, { 
                    text: `🔒 *Access Denied*

This order does not belong to your account.` 
                });
                return;
            }
            
            const statusInfo = getStatusInfo(order.status);
            const trackingVisual = createTrackingVisual(order.status);
            
            const itemsList = order.items.map(item => 
                `   • ${item.name} x${item.quantity} = ${formatPKR(item.price * item.quantity)}`
            ).join('\n');
            
            const trackingMsg = `
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

*Bill Details:*
Subtotal: ${formatPKR(order.subtotal || (order.total - DELIVERY_FEE))}
Tax (5%): ${formatPKR(order.tax || 0)}
Delivery Fee: ${formatPKR(DELIVERY_FEE)}
━━━━━━━━━━━━━━━━━━━━
*Total: ${formatPKR(order.total)}*

*Payment Method:* ${order.method || 'Cash on Delivery'}

*Delivery Address:*
${order.address || 'Not specified'}

━━━━━━━━━━━━━━━━━━━━
💡 *You'll receive automatic updates when status changes!*

_Need help? Contact support: support@javagoat.com_
            `;
            
            await sock.sendMessage(sender, { text: trackingMsg });
            
            // Start watching this order for status updates
            await watchOrderStatus(order.id, sender, sock);
            return;
        }

        // ============ CHECKOUT PROCESS ============
        if (session.state === ORDER_STATES.CHECKOUT_NAME) {
            session.tempData.name = text;
            session.state = ORDER_STATES.CHECKOUT_PHONE;
            await sock.sendMessage(sender, { 
                text: `📱 *Phone Number*

Please provide your phone number for delivery coordination:

*Example:* 03XX 1234567

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

*Example:* House #123, Street 5, DHA Phase 2, Karachi

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
Delivery Fee: ${formatPKR(DELIVERY_FEE)}
━━━━━━━━━━━━━━━━━━━━
*Total: ${formatPKR(cartSummary.total)}*

👤 *Delivery Details:*
Name: ${session.tempData.name}
Phone: ${session.tempData.phone}
Address: ${session.tempData.address}

━━━━━━━━━━━━━━━━━━━━
*Reply with:*
✓ *CONFIRM* - To place your order
✗ *CANCEL* - To cancel order

_Once confirmed, you'll receive tracking updates automatically!_`;
            
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
                    
                    // Send confirmation with tracking info
                    const confirmText = `
✅ *ORDER CONFIRMED!* ✅

*Order ID:* #${savedOrderId.substring(0, 8)}

${cartSummary.itemsList}

*Total Amount:* ${formatPKR(cartSummary.total)}

🚚 *Delivery Details:*
📍 ${session.tempData.address}
📞 ${session.tempData.phone}

━━━━━━━━━━━━━━━━━━━━
*What's Next?*

1️⃣ You'll receive status updates automatically
2️⃣ Track anytime: *track ${savedOrderId.substring(0, 8)}*
3️⃣ Show this ID when picking up

*Estimated Delivery Time:* 30-45 minutes

Thank you for ordering from JavaGoat! 🍔

_Reply *menu* to see more items_`;
                    
                    await sock.sendMessage(sender, { text: confirmText });
                    
                    // Send notification to Firebase
                    await sendNotification(
                        `whatsapp_${waNumber}`,
                        `Order #${savedOrderId.substring(0, 8)} Placed!`,
                        `Your order total is ${formatPKR(cartSummary.total)}. We'll notify you when it's ready!`
                    );
                    
                    // Start watching this order
                    await watchOrderStatus(savedOrderId, sender, sock);
                    
                    // Reset session
                    userSessions[sender] = {
                        cart: [],
                        state: ORDER_STATES.IDLE,
                        tempData: {}
                    };
                    
                } catch (error) {
                    await sock.sendMessage(sender, { 
                        text: `❌ *Order Failed*

There was an error processing your order.

Please try again later or contact support.

Error: ${error.message}` 
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

Type *menu* to start a new order.` 
                });
            } else {
                await sock.sendMessage(sender, { 
                    text: `Please reply with *CONFIRM* to place your order or *CANCEL* to cancel.` 
                });
            }
            return;
        }

        // ============ SHOW CART ============
        if (text === "cart" || text === "view cart" || text === "my cart") {
            if (session.cart.length === 0) {
                await sock.sendMessage(sender, { 
                    text: `🛒 *Your cart is empty*

Add items using:
*order [item name]*
or
*buy [item name]*

Type *menu* to see our delicious food options!` 
                });
                return;
            }
            
            const cartSummary = getCartSummary(session.cart);
            const cartMsg = `
🛒 *YOUR CART* 🛒

${cartSummary.itemsList}

━━━━━━━━━━━━━━━━━━━━
*Subtotal:* ${formatPKR(cartSummary.subtotal)}
*Tax (5%):* ${formatPKR(cartSummary.tax)}
*Delivery:* ${formatPKR(DELIVERY_FEE)}
━━━━━━━━━━━━━━━━━━━━
*Total:* ${formatPKR(cartSummary.total)}

*Commands:*
✓ *checkout* - Place order
🗑️ *clear cart* - Remove all items
➖ *remove [item]* - Remove specific item
📋 *menu* - Add more items`;
            
            await sock.sendMessage(sender, { text: cartMsg });
            return;
        }
        
        // ============ CLEAR CART ============
        if (text === "clear cart" || text === "empty cart") {
            session.cart = [];
            await sock.sendMessage(sender, { 
                text: `🗑️ *Cart Cleared*

Your cart has been emptied.

Type *menu* to browse our food and start fresh!` 
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
                const removedItem = session.cart[itemIndex];
                session.cart.splice(itemIndex, 1);
                await sock.sendMessage(sender, { 
                    text: `🗑️ *Removed* ${removedItem.name}

Type *cart* to see your updated cart.` 
                });
            } else {
                await sock.sendMessage(sender, { 
                    text: `❌ Could not find "${itemToRemove}" in your cart.

Type *cart* to see what's in your cart.` 
                });
            }
            return;
        }
        
        // ============ CHECKOUT ============
        if (text === "checkout" || text === "place order" || text === "order now") {
            if (session.cart.length === 0) {
                await sock.sendMessage(sender, { 
                    text: `🛒 *Cart is Empty*

Add items to your cart first using:
*order [item name]*

Type *menu* to browse our food!` 
                });
                return;
            }
            
            session.state = ORDER_STATES.CHECKOUT_NAME;
            await sock.sendMessage(sender, { 
                text: `👤 *Your Name*

Please provide your full name for delivery:

*Example:* Muhammad Ali

_This helps our rider identify you_` 
            });
            return;
        }
        
        // ============ ADD TO CART ============
        if (text.startsWith("order ") || text.startsWith("buy ")) {
            const productRequested = text.replace(/^(order|buy) /, "").trim().toLowerCase();
            const currentMenu = await getMenuFromApp();
            
            const matchedItems = currentMenu.filter(item => 
                item.name.toLowerCase().includes(productRequested)
            );
            
            if (matchedItems.length === 0) {
                await sock.sendMessage(sender, { 
                    text: `❌ *Not Found*

Sorry, we couldn't find *${productRequested}* in our menu.

Type *menu* to see all available items.

💡 *Tip:* Try searching with a smaller keyword like "biryani" instead of "chicken biryani"` 
                });
                return;
            }
            
            // If multiple matches, show options
            if (matchedItems.length > 1) {
                let optionsMsg = `🔍 *Multiple items found for "${productRequested}"*

Please reply with the number:

`;
                matchedItems.forEach((item, idx) => {
                    optionsMsg += `${idx + 1}. *${item.name}* - ${formatPKR(item.price)}\n`;
                });
                optionsMsg += `\nOr type *cancel* to cancel.`;
                
                session.state = ORDER_STATES.BROWSING_MENU;
                session.tempData.matchedItems = matchedItems;
                await sock.sendMessage(sender, { text: optionsMsg });
                return;
            }
            
            // Single item - ask for quantity
            const item = matchedItems[0];
            session.state = ORDER_STATES.ADDING_TO_CART;
            session.tempData.selectedItem = item;
            
            const quantityMsg = `🛒 *Add to Cart*

*${item.name}* - ${formatPKR(item.price)}

Please reply with the quantity (1-10):

_Type *cancel* to cancel_

💡 *You can add multiple items before checkout!*`;
            
            if (item.imageUrl) {
                await sock.sendMessage(sender, { 
                    image: { url: item.imageUrl }, 
                    caption: quantityMsg 
                });
            } else {
                await sock.sendMessage(sender, { text: quantityMsg });
            }
            return;
        }
        
        // Handle quantity input
        if (session.state === ORDER_STATES.ADDING_TO_CART) {
            if (text === "cancel") {
                session.state = ORDER_STATES.IDLE;
                session.tempData = {};
                await sock.sendMessage(sender, { 
                    text: `❌ *Cancelled*

Item was not added to cart.

Type *menu* to browse or *cart* to see your items.` 
                });
                return;
            }
            
            const quantity = parseInt(text);
            if (isNaN(quantity) || quantity < 1 || quantity > 10) {
                await sock.sendMessage(sender, { 
                    text: `❌ *Invalid Quantity*

Please enter a number between 1 and 10.

Example: *2*` 
                });
                return;
            }
            
            const item = session.tempData.selectedItem;
            
            // Check if item already exists
            const existingItemIndex = session.cart.findIndex(cartItem => cartItem.id === item.id);
            if (existingItemIndex !== -1) {
                session.cart[existingItemIndex].quantity += quantity;
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
            
            const cartSummary = getCartSummary(session.cart);
            const addMsg = `
✅ *Added to Cart!*

${quantity}x ${item.name} added.

📊 *Current Cart Total:* ${formatPKR(cartSummary.total)}
📦 *Total Items:* ${cartSummary.itemCount}

*What now?*
• Type *cart* - View cart
• Type *checkout* - Place order
• Type *menu* - Add more items
• Type *order [item]* - Continue shopping`;
            
            await sock.sendMessage(sender, { text: addMsg });
            return;
        }
        
        // Handle multiple item selection
        if (session.state === ORDER_STATES.BROWSING_MENU) {
            const selection = parseInt(text);
            const matchedItems = session.tempData.matchedItems;
            
            if (!isNaN(selection) && selection >= 1 && selection <= matchedItems.length) {
                const selectedItem = matchedItems[selection - 1];
                session.state = ORDER_STATES.ADDING_TO_CART;
                session.tempData.selectedItem = selectedItem;
                session.tempData.matchedItems = null;
                
                await sock.sendMessage(sender, { 
                    text: `Please reply with the quantity for *${selectedItem.name}* (1-10):

Type *cancel* to cancel.` 
                });
            } else if (text === "cancel") {
                session.state = ORDER_STATES.IDLE;
                session.tempData = {};
                await sock.sendMessage(sender, { text: `❌ Cancelled. Type *menu* to browse.` });
            } else {
                await sock.sendMessage(sender, { 
                    text: `Please reply with a number between 1 and ${matchedItems.length}, or type *cancel*.` 
                });
            }
            return;
        }
        
        // ============ DISPLAY MENU ============
        if (text.includes("menu") || text === "menu" || text === "food" || text === "dishes") {
            const currentMenu = await getMenuFromApp();
            
            if (currentMenu.length === 0) {
                await sock.sendMessage(sender, { 
                    text: `🍽️ *Menu Currently Empty*

Please check back soon! Our menu is being updated.` 
                });
                return;
            }
            
            let menuMessage = `🍔 *JAVAGOAT MENU* 🍕\n\n`;
            menuMessage += `━━━━━━━━━━━━━━━━━━━━\n`;
            
            currentMenu.slice(0, 15).forEach((item, idx) => {
                menuMessage += `${idx + 1}. *${item.name}*\n`;
                menuMessage += `   💰 ${formatPKR(item.price)}\n`;
                menuMessage += `   ━━━━━━━━━━━━━━━\n`;
            });
            
            if (currentMenu.length > 15) {
                menuMessage += `\n_And ${currentMenu.length - 15} more items available..._\n`;
            }
            
            menuMessage += `\n📝 *How to order:*\n`;
            menuMessage += `• Type *order [dish name]*\n`;
            menuMessage += `• Example: *order biryani*\n\n`;
            
            menuMessage += `✨ *Other Commands:*\n`;
            menuMessage += `• *cart* - View your cart\n`;
            menuMessage += `• *checkout* - Place order\n`;
            menuMessage += `• *track* - Track your orders\n`;
            menuMessage += `• *help* - Show all commands\n\n`;
            
            menuMessage += `💡 *Tip:* You can add multiple items before checking out!`;
            
            await sock.sendMessage(sender, { text: menuMessage });
            return;
        }
        
        // ============ HELP COMMAND ============
        if (text === "help" || text === "commands" || text === "?" || text === "menu help") {
            const helpMsg = `
╔════════════════════════════════╗
║     🤖 JAVAGOAT BOT COMMANDS    ║
╚════════════════════════════════╝

🛒 *Ordering:*
• *menu* - See all food items
• *order [item]* - Add item to cart
• *buy [item]* - Quick add to cart
• *cart* - View your cart
• *remove [item]* - Remove from cart
• *clear cart* - Empty cart
• *checkout* - Place order

📦 *Order Tracking:*
• *track* - See your recent orders
• *track [ORDER_ID]* - Track specific order
• *orders* - View order history

ℹ️ *General:*
• *help* - Show this menu
• *hi/hello* - Greeting
• *contact* - Support info

💡 *Examples:*
• order biryani
• track ORD_12345678
• checkout

━━━━━━━━━━━━━━━━━━━━
📞 *Support:* support@javagoat.com
⏰ *Hours:* 10 AM - 10 PM

_You'll receive automatic updates for all your orders!_`;
            
            await sock.sendMessage(sender, { text: helpMsg });
            return;
        }
        
        // ============ ORDERS HISTORY ============
        if (text === "orders" || text === "history" || text === "my orders") {
            const userOrders = await getUserOrders(waNumber);
            
            if (userOrders.length === 0) {
                await sock.sendMessage(sender, { 
                    text: `📭 *No Order History*

You haven't placed any orders yet.

Type *menu* to see our delicious food and place your first order!` 
                });
                return;
            }
            
            let historyMsg = `📜 *ORDER HISTORY* 📜\n\n`;
            historyMsg += `Total Orders: ${userOrders.length}\n`;
            historyMsg += `━━━━━━━━━━━━━━━━━━━━\n\n`;
            
            userOrders.forEach((order, idx) => {
                const date = new Date(order.timestamp).toLocaleDateString();
                historyMsg += `${idx + 1}. #${order.id.substring(0, 8)}\n`;
                historyMsg += `   📅 ${date}\n`;
                historyMsg += `   💰 ${formatPKR(order.total)}\n`;
                historyMsg += `   📦 ${order.status}\n`;
                historyMsg += `   ━━━━━━━━━━━━━━━\n`;
            });
            
            historyMsg += `\n_To track any order, type: track ORDER_ID_\n`;
            historyMsg += `_Example: track ${userOrders[0].id.substring(0, 8)}_`;
            
            await sock.sendMessage(sender, { text: historyMsg });
            return;
        }
        
        // ============ GREETINGS ============
        if (text.match(/^(hi|hello|hey|greetings|good morning|good afternoon|good evening|start|hello bot)$/i)) {
            const greetingMsg = `
╔════════════════════════════════╗
║   👋 WELCOME TO JAVAGOAT! 🐐   ║
╚════════════════════════════════╝

Your favorite food delivery service is here!

🍔 *Get Started:*
1️⃣ Type *menu* to see our delicious food
2️⃣ Type *order [dish]* to start ordering
3️⃣ Type *checkout* when ready

📦 *Track Orders:*
• Type *track* to see your orders
• Get automatic status updates

💡 *Quick Examples:*
• order biryani
• cart
• checkout

_What would you like to order today?_`;
            
            await sock.sendMessage(sender, { text: greetingMsg });
            return;
        }
        
        // ============ CONTACT INFO ============
        if (text.includes("contact") || text.includes("support") || text.includes("help desk")) {
            const contactMsg = `
📞 *Contact JavaGoat Support*

💬 *WhatsApp Support:* +92 XXX XXXXXXX
📧 *Email:* support@javagoat.com
⏰ *Hours:* 10 AM - 10 PM (Daily)

*Quick Links:*
• Order issues: support@javagoat.com
• Delivery tracking: track [order_id]
• Feedback: feedback@javagoat.com

For urgent issues, please call our support line.

_We typically respond within 15 minutes!_`;
            
            await sock.sendMessage(sender, { text: contactMsg });
            return;
        }
        
        // ============ DEFAULT RESPONSE ============
        if (session.state === ORDER_STATES.IDLE) {
            const defaultMsg = `
🤔 *I didn't quite understand that.*

📋 *Available Commands:*
• *menu* - View our food menu
• *order [food]* - Place an order
• *track* - Track your orders
• *cart* - View your cart
• *help* - Show all commands

💡 *Tip:* Type *help* for complete command list!

_Example: order biryani_`;
            
            await sock.sendMessage(sender, { text: defaultMsg });
        }
    });
}

startBot().catch(err => console.log("Error: " + err));
