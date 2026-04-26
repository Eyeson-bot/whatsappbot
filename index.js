const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');

// Firebase Configuration
const FIREBASE_URL = process.env.FIREBASE_URL;
const DELIVERY_FEE = 150; // PKR Delivery Fee
const TAX_RATE = 0.05; // 5% Tax

// Store user sessions
const userSessions = {}; // Stores cart, order history, current order status

// Order states
const ORDER_STATES = {
    IDLE: 'IDLE',
    BROWSING_MENU: 'BROWSING_MENU',
    ADDING_TO_CART: 'ADDING_TO_CART',
    VIEWING_CART: 'VIEWING_CART',
    CHECKOUT_ADDRESS: 'CHECKOUT_ADDRESS',
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

// Function to get user's recent orders
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

// Function to get order status by ID
async function getOrderStatus(orderId) {
    try {
        const response = await fetch(`${FIREBASE_URL}/orders/${orderId}.json`);
        const order = await response.json();
        return order;
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
        return result.name; // Returns order ID
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
        itemsList += `${index + 1}. ${item.name} x${item.quantity} = PKR ${itemTotal}\n`;
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

// Format currency to PKR
function formatPKR(amount) {
    return `PKR ${amount.toFixed(2)}`;
}

// Get status emoji and message
function getStatusInfo(status) {
    const statusMap = {
        'Placed': { emoji: '📋', message: 'Order placed and confirmed' },
        'Preparing': { emoji: '🔪', message: 'Restaurant is preparing your food' },
        'Out for Delivery': { emoji: '🚚', message: 'Rider is on the way with your order' },
        'Delivered': { emoji: '✅', message: 'Order delivered successfully' },
        'Cancelled': { emoji: '❌', message: 'Order was cancelled' }
    };
    return statusMap[status] || { emoji: '📋', message: 'Order received' };
}

async function startBot() {
    if (!FIREBASE_URL) {
        console.log("❌ ERROR: FIREBASE_URL is missing in GitHub Secrets!");
        process.exit(1);
    }

    const { state, saveCreds } = await useMultiFileAuthState('session_data');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ["JavaGoat", "Chrome", "1.0"]
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.clear();
            console.log('\n==================================================');
            console.log('📱 SCAN QR CODE WITH YOUR WHATSAPP');
            console.log('==================================================\n');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'open') {
            console.log('✅ JAVAGOAT BOT IS ONLINE!');
            console.log('📱 Bot is ready to take orders!');
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

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;
        if (msg.key.fromMe) return;

        const sender = msg.key.remoteJid;
        const waNumber = sender.split('@')[0];
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim().toLowerCase();
        
        // Initialize user session if not exists
        if (!userSessions[sender]) {
            userSessions[sender] = {
                cart: [],
                state: ORDER_STATES.IDLE,
                tempData: {}
            };
        }
        
        const session = userSessions[sender];
        
        console.log(`📩 Message from ${waNumber}: ${text}`);

        // ============ ORDER TRACKING FEATURE ============
        if (text === "track" || text.startsWith("track ")) {
            let orderId = text.replace("track", "").trim();
            
            if (!orderId) {
                // If no order ID provided, show their recent orders
                const userOrders = await getUserOrders(waNumber);
                if (userOrders.length === 0) {
                    await sock.sendMessage(sender, { 
                        text: "📭 *No Orders Found*\n\nYou haven't placed any orders yet.\n\nType *menu* to see our delicious food options!" 
                    });
                } else {
                    let recentOrdersMsg = "📋 *Your Recent Orders*\n\n";
                    userOrders.slice(0, 5).forEach((order, idx) => {
                        const statusInfo = getStatusInfo(order.status);
                        recentOrdersMsg += `${idx + 1}. *Order #${order.id.substring(0, 8)}*\n`;
                        recentOrdersMsg += `   ${statusInfo.emoji} Status: ${order.status}\n`;
                        recentOrdersMsg += `   📅 ${new Date(order.timestamp).toLocaleDateString()}\n`;
                        recentOrdersMsg += `   💰 Total: ${formatPKR(order.total)}\n\n`;
                    });
                    recentOrdersMsg += "_To track specific order, type: track ORDER_ID_\n";
                    recentOrdersMsg += "_Example: track abc123_";
                    
                    await sock.sendMessage(sender, { text: recentOrdersMsg });
                }
                return;
            }
            
            // Track specific order
            const order = await getOrderStatus(orderId);
            if (!order) {
                await sock.sendMessage(sender, { 
                    text: "❌ *Order Not Found*\n\nPlease check the order ID and try again.\nType *track* to see your recent orders." 
                });
                return;
            }
            
            const statusInfo = getStatusInfo(order.status);
            const itemsList = order.items.map(item => 
                `• ${item.name} x${item.quantity} = ${formatPKR(item.price * item.quantity)}`
            ).join('\n');
            
            const trackingMsg = `
🚚 *ORDER TRACKING* 🚚

*Order ID:* #${orderId.substring(0, 8)}
*Status:* ${statusInfo.emoji} ${order.status}
*Message:* ${statusInfo.message}

*Items:*
${itemsList}

*Total:* ${formatPKR(order.total)}
*Payment:* ${order.method || 'Cash on Delivery'}

*Delivery Address:*
${order.address || 'Not specified'}

📅 *Order Date:* ${new Date(order.timestamp).toLocaleString()}

_For support, contact: support@javagoat.com_
            `;
            
            await sock.sendMessage(sender, { text: trackingMsg });
            return;
        }

        // ============ CHECKOUT PROCESS ============
        if (session.state === ORDER_STATES.CHECKOUT_ADDRESS) {
            session.tempData.address = text;
            session.state = ORDER_STATES.CHECKOUT_PHONE;
            await sock.sendMessage(sender, { 
                text: "📱 *Phone Number*\n\nPlease provide your phone number for delivery coordination:\n\nExample: 03XX 1234567" 
            });
            return;
        }
        
        if (session.state === ORDER_STATES.CHECKOUT_PHONE) {
            session.tempData.phone = text;
            session.state = ORDER_STATES.CONFIRMING_ORDER;
            
            const cartSummary = getCartSummary(session.cart);
            const confirmMsg = `
🛒 *ORDER SUMMARY*

${cartSummary.itemsList}

📊 *Breakdown:*
Subtotal: ${formatPKR(cartSummary.subtotal)}
Tax (5%): ${formatPKR(cartSummary.tax)}
Delivery Fee: ${formatPKR(DELIVERY_FEE)}
━━━━━━━━━━━━━━━
*Total: ${formatPKR(cartSummary.total)}*

👤 *Delivery Details:*
Address: ${session.tempData.address}
Phone: ${session.tempData.phone}

Reply with *CONFIRM* to place your order, or *CANCEL* to cancel.
            `;
            
            await sock.sendMessage(sender, { text: confirmMsg });
            return;
        }
        
        if (session.state === ORDER_STATES.CONFIRMING_ORDER) {
            if (text === "confirm") {
                // Create order object
                const orderItems = session.cart.map(item => ({
                    id: item.id,
                    name: item.name,
                    price: item.price,
                    quantity: item.quantity,
                    img: item.imageUrl || ""
                }));
                
                const cartSummary = getCartSummary(session.cart);
                const orderId = `ORD_${Date.now()}_${waNumber.slice(-4)}`;
                
                const newOrder = {
                    userId: `whatsapp_${waNumber}`,
                    userEmail: `${waNumber}@whatsapp.javagoat.com`,
                    customerName: session.tempData.name || "WhatsApp Customer",
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
                    orderId: orderId,
                    source: "WhatsApp Bot"
                };
                
                try {
                    const savedOrderId = await saveOrder(newOrder);
                    
                    // Send order confirmation with image
                    const confirmText = `
✅ *ORDER CONFIRMED!* ✅

*Order ID:* #${savedOrderId.substring(0, 8)}

${cartSummary.itemsList}

*Total Amount:* ${formatPKR(cartSummary.total)}

🚚 *Delivery Details:*
📍 ${session.tempData.address}
📞 ${session.tempData.phone}

*Estimated Delivery Time:* 30-45 minutes

You can track your order anytime by typing:
*track ${savedOrderId.substring(0, 8)}*

Thank you for ordering from JavaGoat! 🍔
                    `;
                    
                    await sock.sendMessage(sender, { text: confirmText });
                    
                    // Reset session
                    userSessions[sender] = {
                        cart: [],
                        state: ORDER_STATES.IDLE,
                        tempData: {}
                    };
                    
                } catch (error) {
                    await sock.sendMessage(sender, { 
                        text: "❌ *Order Failed*\n\nThere was an error processing your order. Please try again later." 
                    });
                }
                
            } else if (text === "cancel") {
                userSessions[sender] = {
                    cart: [],
                    state: ORDER_STATES.IDLE,
                    tempData: {}
                };
                await sock.sendMessage(sender, { 
                    text: "❌ *Order Cancelled*\n\nYour order has been cancelled. Type *menu* to start a new order." 
                });
            } else {
                await sock.sendMessage(sender, { 
                    text: "Please reply with *CONFIRM* to place your order or *CANCEL* to cancel." 
                });
            }
            return;
        }

        // ============ SHOW CART ============
        if (text === "cart" || text === "view cart") {
            if (session.cart.length === 0) {
                await sock.sendMessage(sender, { 
                    text: "🛒 *Your cart is empty*\n\nAdd items using:\n*order [item name]*\nor\n*buy [item name]*" 
                });
                return;
            }
            
            const cartSummary = getCartSummary(session.cart);
            const cartMsg = `
🛒 *YOUR CART* 🛒

${cartSummary.itemsList}

📊 *Total:* ${formatPKR(cartSummary.total)} (including tax & delivery)

Commands:
• *checkout* - Proceed to payment
• *clear cart* - Remove all items
• *menu* - Add more items
            `;
            await sock.sendMessage(sender, { text: cartMsg });
            return;
        }
        
        // ============ CLEAR CART ============
        if (text === "clear cart" || text === "empty cart") {
            session.cart = [];
            await sock.sendMessage(sender, { 
                text: "🗑️ *Cart Cleared*\n\nYour cart has been emptied. Type *menu* to browse our food." 
            });
            return;
        }
        
        // ============ CHECKOUT ============
        if (text === "checkout" || text === "order now") {
            if (session.cart.length === 0) {
                await sock.sendMessage(sender, { 
                    text: "🛒 *Cart is Empty*\n\nAdd items to your cart first using:\n*order [item name]*" 
                });
                return;
            }
            
            session.state = ORDER_STATES.CHECKOUT_ADDRESS;
            await sock.sendMessage(sender, { 
                text: "📍 *Delivery Address*\n\nPlease provide your complete delivery address:\n\nExample: House #123, Street 5, DHA, Karachi" 
            });
            return;
        }
        
        // ============ REMOVE ITEM FROM CART ============
        if (text.startsWith("remove ")) {
            const itemToRemove = text.replace("remove ", "").trim();
            const itemIndex = session.cart.findIndex(item => 
                item.name.toLowerCase().includes(itemToRemove)
            );
            
            if (itemIndex !== -1) {
                const removedItem = session.cart[itemIndex];
                session.cart.splice(itemIndex, 1);
                await sock.sendMessage(sender, { 
                    text: `🗑️ Removed *${removedItem.name}* from your cart.\n\nType *cart* to see updated cart.` 
                });
            } else {
                await sock.sendMessage(sender, { 
                    text: `❌ Could not find "${itemToRemove}" in your cart.\n\nType *cart* to see what's in your cart.` 
                });
            }
            return;
        }
        
        // ============ ADD TO CART / ORDER ITEM ============
        if (text.startsWith("order ") || text.startsWith("buy ")) {
            const productRequested = text.replace(/^(order|buy) /, "").trim().toLowerCase();
            const currentMenu = await getMenuFromApp();
            
            // Search for matching item
            const matchedItems = currentMenu.filter(item => 
                item.name.toLowerCase().includes(productRequested)
            );
            
            if (matchedItems.length === 0) {
                await sock.sendMessage(sender, { 
                    text: `❌ Sorry, we couldn't find *${productRequested}* in our menu.\n\nType *menu* to see all available items.` 
                });
                return;
            }
            
            // If multiple matches, show options
            if (matchedItems.length > 1) {
                let optionsMsg = `🔍 *Multiple items found for "${productRequested}"*\n\nPlease reply with the number:\n\n`;
                matchedItems.forEach((item, idx) => {
                    optionsMsg += `${idx + 1}. ${item.name} - ${formatPKR(item.price)}\n`;
                });
                optionsMsg += `\nOr type *cancel* to cancel.`;
                
                session.state = ORDER_STATES.BROWSING_MENU;
                session.tempData.matchedItems = matchedItems;
                await sock.sendMessage(sender, { text: optionsMsg });
                return;
            }
            
            // Single item found - ask for quantity
            const item = matchedItems[0];
            session.state = ORDER_STATES.ADDING_TO_CART;
            session.tempData.selectedItem = item;
            
            const quantityMsg = `🛒 *Add to Cart*\n\n*${item.name}* - ${formatPKR(item.price)}\n\nPlease reply with the quantity (1-10):\n\n_Type *cancel* to cancel_`;
            
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
                    text: "❌ *Cancelled*\n\nItem not added to cart. Type *menu* to browse." 
                });
                return;
            }
            
            const quantity = parseInt(text);
            if (isNaN(quantity) || quantity < 1 || quantity > 10) {
                await sock.sendMessage(sender, { 
                    text: "❌ *Invalid Quantity*\n\nPlease enter a number between 1 and 10." 
                });
                return;
            }
            
            const item = session.tempData.selectedItem;
            
            // Check if item already exists in cart
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
            
            const addMsg = `
✅ *Added to Cart!*

${quantity}x ${item.name} added to your cart.

*Current Cart Total:* ${formatPKR(getCartSummary(session.cart).total)}

Type *cart* to view cart
Type *checkout* to place order
Type *menu* to add more items
            `;
            
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
                    text: `Please reply with the quantity for *${selectedItem.name}* (1-10):\n\nType *cancel* to cancel.` 
                });
            } else if (text === "cancel") {
                session.state = ORDER_STATES.IDLE;
                session.tempData = {};
                await sock.sendMessage(sender, { text: "❌ Cancelled. Type *menu* to browse." });
            } else {
                await sock.sendMessage(sender, { 
                    text: `Please reply with a number between 1 and ${matchedItems.length}, or type *cancel*.` 
                });
            }
            return;
        }
        
        // ============ DISPLAY MENU ============
        if (text.includes("menu") || text.includes("price") || text.includes("list") || text.includes("food") || text === "menu") {
            const currentMenu = await getMenuFromApp();
            
            if (currentMenu.length === 0) {
                await sock.sendMessage(sender, { 
                    text: "🍽️ *Our menu is currently empty*\n\nPlease check back soon!" 
                });
                return;
            }
            
            let menuMessage = "🍔 *JAVAGOAT MENU* 🍕\n\n";
            currentMenu.slice(0, 15).forEach((item, idx) => {
                menuMessage += `${idx + 1}. *${item.name}* - ${formatPKR(item.price)}\n`;
            });
            
            if (currentMenu.length > 15) {
                menuMessage += `\n_And ${currentMenu.length - 15} more items..._\n`;
            }
            
            menuMessage += "\n📝 *How to order:*\n";
            menuMessage += "• Type *order [dish name]*\n";
            menuMessage += "• Example: *order biryani*\n\n";
            menuMessage += "✨ *Other Commands:*\n";
            menuMessage += "• *cart* - View your cart\n";
            menuMessage += "• *checkout* - Place order\n";
            menuMessage += "• *track* - Track your orders\n";
            menuMessage += "• *help* - Show all commands";
            
            await sock.sendMessage(sender, { text: menuMessage });
            return;
        }
        
        // ============ HELP COMMAND ============
        if (text === "help" || text === "commands" || text === "?" || text === "menu help") {
            const helpMsg = `
🤖 *JAVAGOAT BOT COMMANDS* 🤖

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

ℹ️ *General:*
• *help* - Show this menu
• *hi/hello* - Greeting
• *contact* - Support info

💡 *Examples:*
• order biryani
• order pizza
• track ORD_123456

_For support: support@javagoat.com_
            `;
            await sock.sendMessage(sender, { text: helpMsg });
            return;
        }
        
        // ============ GREETINGS ============
        if (text.match(/^(hi|hello|hey|greetings|good morning|good afternoon|good evening)$/i)) {
            const greetingMsg = `
👋 *Welcome to JavaGoat!* 🐐

Your favorite food delivery service is here!

🍔 Type *menu* to see our delicious food
🛒 Type *order [dish]* to start ordering
📦 Type *track* to check your orders

What would you like to order today?
            `;
            await sock.sendMessage(sender, { text: greetingMsg });
            return;
        }
        
        // ============ CONTACT INFO ============
        if (text.includes("contact") || text.includes("support") || text.includes("help")) {
            const contactMsg = `
📞 *Contact JavaGoat Support*

💬 *WhatsApp Support:* +92 XXX XXXXXXX
📧 *Email:* support@javagoat.com
⏰ *Hours:* 10 AM - 10 PM (Daily)

For urgent issues, please call our support line.
            `;
            await sock.sendMessage(sender, { text: contactMsg });
            return;
        }
        
        // ============ DEFAULT RESPONSE ============
        if (session.state === ORDER_STATES.IDLE) {
            const defaultMsg = `
🤔 I didn't quite understand that.

📋 *Available Commands:*
• *menu* - View our food menu
• *order [food]* - Place an order
• *track* - Track your orders
• *help* - Show all commands

Type *help* for complete command list!
            `;
            await sock.sendMessage(sender, { text: defaultMsg });
        }
    });
}

startBot().catch(err => console.log("Error: " + err));
