<?php
// --- FIREBASE CONFIGURATION ---
$firebaseConfig = [
  "apiKey" => "YOUR_API_KEY_HERE",
  "authDomain" => "YOUR_PROJECT_ID.firebaseapp.com",
  "databaseURL" => "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  "projectId" => "YOUR_PROJECT_ID",
  "storageBucket" => "YOUR_PROJECT_ID.firebasestorage.app",
  "messagingSenderId" => "YOUR_MESSAGING_SENDER_ID",
  "appId" => "YOUR_APP_ID"
];
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>JavaGoat Admin | Premium Dashboard</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.1.1/css/all.min.css">
    <style>
        :root {
            --primary: #10b981;
            --primary-dark: #059669;
            --primary-soft: #d1fae5;
            --bg-body: #f8fafc;
            --bg-card: #ffffff;
            --text-main: #0f172a;
            --text-muted: #64748b;
            --border: #e2e8f0;
            --sidebar-width: 260px;
            --danger: #ef4444;
            --warning: #f59e0b;
            --info: #3b82f6;
        }

        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }

        body {
            margin: 0;
            font-family: 'Plus Jakarta Sans', sans-serif;
            background-color: var(--bg-body);
            color: var(--text-main);
            display: flex;
            height: 100vh;
            overflow: hidden;
        }

        /* --- Custom Scrollbar --- */
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }

        /* --- Sidebar --- */
        .sidebar {
            width: var(--sidebar-width);
            background-color: #0f172a;
            display: flex;
            flex-direction: column;
            padding: 24px;
            transition: all 0.3s ease;
            z-index: 100;
        }

        .logo {
            display: flex;
            align-items: center;
            gap: 12px;
            font-size: 1.4rem;
            font-weight: 800;
            color: white;
            margin-bottom: 40px;
            letter-spacing: -0.5px;
        }
        .logo i { color: var(--primary); }

        .nav-links { list-style: none; padding: 0; margin: 0; flex: 1; }
        .nav-item {
            display: flex;
            align-items: center;
            padding: 12px 16px;
            color: #94a3b8;
            text-decoration: none;
            border-radius: 12px;
            margin-bottom: 8px;
            cursor: pointer;
            font-weight: 500;
            transition: all 0.2s;
        }
        .nav-item i { width: 24px; font-size: 1.1rem; }
        .nav-item:hover { background: rgba(255,255,255,0.05); color: white; }
        .nav-item.active { background: var(--primary); color: white; }

        .logout-btn { color: #f87171; margin-top: auto; }

        /* --- Main Layout --- */
        .main-wrapper {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            position: relative;
        }

        .top-bar {
            height: 70px;
            background: white;
            border-bottom: 1px solid var(--border);
            display: flex;
            align-items: center;
            padding: 0 40px;
            justify-content: space-between;
        }

        .mobile-toggle { display: none; font-size: 1.5rem; cursor: pointer; }

        .content-area {
            flex: 1;
            overflow-y: auto;
            padding: 40px;
        }

        /* --- Sections --- */
        .section { display: none; }
        .section.active { display: block; animation: fadeIn 0.4s ease; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

        .header-flex {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 30px;
        }
        .header-flex h1 { font-size: 1.8rem; font-weight: 800; margin: 0; letter-spacing: -1px; }

        /* --- Stats Card --- */
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
            gap: 20px;
            margin-bottom: 40px;
        }
        .stat-card {
            background: white;
            padding: 24px;
            border-radius: 20px;
            border: 1px solid var(--border);
            display: flex;
            align-items: center;
            gap: 20px;
        }
        .stat-icon {
            width: 54px; height: 54px;
            background: var(--primary-soft);
            color: var(--primary);
            border-radius: 14px;
            display: flex; align-items: center; justify-content: center;
            font-size: 1.4rem;
        }
        .stat-info h3 { margin: 0; font-size: 1.6rem; font-weight: 800; }
        .stat-info p { margin: 2px 0 0; color: var(--text-muted); font-size: 0.9rem; font-weight: 600; }

        /* --- Orders Table --- */
        .table-container {
            background: white;
            border-radius: 20px;
            border: 1px solid var(--border);
            overflow: hidden;
            box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);
        }
        table { width: 100%; border-collapse: collapse; }
        th {
            background: #f8fafc;
            padding: 16px 24px;
            text-align: left;
            font-size: 0.75rem;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: var(--text-muted);
            border-bottom: 1px solid var(--border);
        }
        td {
            padding: 18px 24px;
            border-bottom: 1px solid var(--border);
            font-size: 0.95rem;
            vertical-align: middle;
        }
        tr:last-child td { border-bottom: none; }

        .customer-info { line-height: 1.4; }
        .customer-info .name { font-weight: 700; display: block; }
        .customer-info .phone { font-size: 0.85rem; color: var(--text-muted); }

        .item-list { font-size: 0.85rem; color: var(--text-muted); max-width: 250px; line-height: 1.5; }
        
        /* Status Select Styling */
        .status-select {
            padding: 8px 12px;
            border-radius: 8px;
            font-weight: 700;
            font-size: 0.8rem;
            border: 1px solid transparent;
            cursor: pointer;
            outline: none;
            transition: all 0.2s;
            width: 140px;
        }
        
        .status-placed { background: #fef3c7; color: #92400e; }
        .status-preparing { background: #e0e7ff; color: #3730a3; }
        .status-delivery { background: #ffedd5; color: #9a3412; }
        .status-delivered { background: #d1fae5; color: #065f46; }

        /* --- Buttons & Inputs --- */
        .btn-add {
            background: var(--primary);
            color: white;
            padding: 12px 24px;
            border-radius: 12px;
            border: none;
            font-weight: 700;
            cursor: pointer;
            display: flex; align-items: center; gap: 8px;
            transition: 0.3s;
        }
        .btn-add:hover { background: var(--primary-dark); transform: translateY(-2px); }

        /* --- Grid for Menu/Restaurants --- */
        .menu-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
            gap: 24px;
        }
        .admin-card {
            background: white; border-radius: 20px; overflow: hidden;
            border: 1px solid var(--border); position: relative;
        }
        .admin-card img { width: 100%; height: 160px; object-fit: cover; }
        .admin-card-body { padding: 20px; }
        .admin-card h4 { margin: 0 0 5px; font-weight: 700; font-size: 1.1rem; }
        .delete-btn {
            position: absolute; top: 10px; right: 10px;
            background: white; color: var(--danger);
            border: none; width: 32px; height: 32px; border-radius: 8px;
            cursor: pointer; box-shadow: 0 4px 10px rgba(0,0,0,0.1);
        }

        /* --- Auth Overlay --- */
        #authOverlay {
            position: fixed; inset: 0; background: var(--bg-body);
            z-index: 2000; display: flex; align-items: center; justify-content: center;
        }
        .login-box {
            background: white; padding: 40px; border-radius: 30px;
            width: 100%; max-width: 400px; border: 1px solid var(--border);
            box-shadow: 0 20px 50px rgba(0,0,0,0.05); text-align: center;
        }
        .login-box input {
            width: 100%; padding: 16px; margin-bottom: 15px;
            border: 1px solid var(--border); border-radius: 12px;
            font-family: inherit; font-size: 1rem;
        }

        /* --- Modals --- */
        .modal {
            display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5);
            z-index: 1000; align-items: center; justify-content: center; padding: 20px;
        }
        .modal-content {
            background: white; padding: 30px; border-radius: 24px;
            width: 100%; max-width: 450px; position: relative;
        }
        .close-modal { position: absolute; right: 20px; top: 20px; cursor: pointer; font-size: 1.5rem; }

        /* =======================================================
           RESPONSIVE REWRITE
           ======================================================= */
        @media (max-width: 992px) {
            .sidebar {
                position: fixed; left: -280px; top: 0; bottom: 0;
            }
            .sidebar.active { left: 0; }
            .mobile-toggle { display: block; }
            .top-bar { padding: 0 20px; }
            .content-area { padding: 20px; }
        }

        @media (max-width: 768px) {
            .header-flex { flex-direction: column; align-items: flex-start; gap: 15px; }
            .btn-add { width: 100%; justify-content: center; }

            /* --- Table to Card Conversion --- */
            .table-container { background: transparent; border: none; box-shadow: none; }
            table, thead, tbody, th, td, tr { display: block; }
            thead { display: none; }
            
            tr {
                background: white; margin-bottom: 20px; padding: 20px;
                border-radius: 20px; border: 1px solid var(--border);
                box-shadow: 0 4px 10px rgba(0,0,0,0.02);
            }
            
            td {
                display: flex; justify-content: space-between; align-items: center;
                padding: 12px 0; border-bottom: 1px solid #f1f5f9;
                text-align: right; font-size: 0.9rem;
            }
            td:last-child { border: none; padding-bottom: 0; }
            td:first-child { padding-top: 0; }

            /* Label Injection */
            td::before {
                content: attr(data-label);
                font-weight: 700; text-transform: uppercase;
                font-size: 0.75rem; color: var(--text-muted);
                text-align: left;
            }

            .item-list { max-width: 60%; }
            .status-select { width: 130px; }
        }
    </style>
</head>
<body>

    <!-- AUTH SECTION -->
    <div id="authOverlay">
        <div class="login-box">
            <div class="logo" style="justify-content: center; color: var(--text-main); margin-bottom: 15px;">
                <i class="fas fa-leaf"></i> JavaGoat
            </div>
            <h2 style="margin-bottom: 25px; letter-spacing: -1px;">Admin Login</h2>
            <input type="email" id="adminEmail" placeholder="Email Address">
            <input type="password" id="adminPassword" placeholder="Password">
            <p id="authError" style="color: var(--danger); font-size: 0.85rem; margin-bottom: 15px; font-weight: 600;"></p>
            <button class="btn-add" id="loginBtn" style="width: 100%; justify-content: center;">Sign In</button>
        </div>
    </div>

    <!-- SIDEBAR -->
    <div class="sidebar" id="sidebar">
        <div class="logo"><i class="fas fa-leaf"></i> JavaGoat</div>
        <ul class="nav-links">
            <li class="nav-item active" data-target="dashboard">
                <i class="fas fa-chart-line"></i> <span>Dashboard</span>
            </li>
            <li class="nav-item" data-target="orders">
                <i class="fas fa-shopping-basket"></i> <span>Orders</span>
            </li>
            <li class="nav-item" data-target="menu">
                <i class="fas fa-utensils"></i> <span>Menu Items</span>
            </li>
            <li class="nav-item" data-target="restaurants">
                <i class="fas fa-store"></i> <span>Restaurants</span>
            </li>
            <li class="nav-item logout-btn" id="logoutBtn">
                <i class="fas fa-sign-out-alt"></i> <span>Logout</span>
            </li>
        </ul>
    </div>

    <div class="main-wrapper">
        <div class="top-bar">
            <div class="mobile-toggle" id="menuToggle"><i class="fas fa-bars"></i></div>
            <div style="font-weight: 700; color: var(--text-muted);">Admin Panel v2.0</div>
            <div id="userEmailDisplay" style="font-size: 0.85rem; font-weight: 600;"></div>
        </div>

        <div class="content-area">
            
            <!-- DASHBOARD -->
            <div id="dashboard" class="section active">
                <div class="header-flex"><h1>Overview</h1></div>
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-icon"><i class="fas fa-indian-rupee-sign"></i></div>
                        <div class="stat-info"><h3 id="stat-revenue">₹0</h3><p>Revenue</p></div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon"><i class="fas fa-bag-shopping"></i></div>
                        <div class="stat-info"><h3 id="stat-orders">0</h3><p>Total Orders</p></div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon"><i class="fas fa-pizza-slice"></i></div>
                        <div class="stat-info"><h3 id="stat-dishes">0</h3><p>Active Dishes</p></div>
                    </div>
                </div>
            </div>

            <!-- ORDERS -->
            <div id="orders" class="section">
                <div class="header-flex">
                    <h1>Order Management</h1>
                </div>
                <div class="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Order ID</th>
                                <th>Customer</th>
                                <th>Items</th>
                                <th>Total</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody id="ordersTableBody">
                            <!-- JS Injection -->
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- MENU -->
            <div id="menu" class="section">
                <div class="header-flex">
                    <h1>Dishes</h1>
                    <button class="btn-add" id="openDishModal"><i class="fas fa-plus"></i> Add New</button>
                </div>
                <div class="menu-grid" id="dishesGrid"></div>
            </div>

            <!-- RESTAURANTS -->
            <div id="restaurants" class="section">
                <div class="header-flex">
                    <h1>Partners</h1>
                    <button class="btn-add" id="openRestModal"><i class="fas fa-plus"></i> Add New</button>
                </div>
                <div class="menu-grid" id="restaurantsGrid"></div>
            </div>

        </div>
    </div>

    <!-- MODAL: ADD DISH -->
    <div id="dishModal" class="modal">
        <div class="modal-content">
            <span class="close-modal">&times;</span>
            <h2 style="margin-bottom: 25px;">New Dish</h2>
            <input type="text" id="dishName" placeholder="Dish Name" class="login-box" style="box-shadow: none; padding: 12px; margin-bottom: 10px;">
            <input type="number" id="dishPrice" placeholder="Price (₹)" class="login-box" style="box-shadow: none; padding: 12px; margin-bottom: 10px;">
            <input type="text" id="dishImage" placeholder="Image URL" class="login-box" style="box-shadow: none; padding: 12px; margin-bottom: 20px;">
            <button class="btn-add" id="saveDishBtn" style="width: 100%; justify-content: center;">Save Item</button>
        </div>
    </div>

    <!-- MODAL: ADD RESTAURANT -->
    <div id="restModal" class="modal">
        <div class="modal-content">
            <span class="close-modal">&times;</span>
            <h2 style="margin-bottom: 25px;">New Restaurant</h2>
            <input type="text" id="restName" placeholder="Name" class="login-box" style="box-shadow: none; padding: 12px; margin-bottom: 10px;">
            <input type="number" step="0.1" id="restRating" placeholder="Rating (1-5)" class="login-box" style="box-shadow: none; padding: 12px; margin-bottom: 10px;">
            <input type="text" id="restImage" placeholder="Image URL" class="login-box" style="box-shadow: none; padding: 12px; margin-bottom: 20px;">
            <button class="btn-add" id="saveRestBtn" style="width: 100%; justify-content: center;">Add Partner</button>
        </div>
    </div>

    <script src="https://www.gstatic.com/firebasejs/8.10.0/firebase-app.js"></script>
    <script src="https://www.gstatic.com/firebasejs/8.10.0/firebase-auth.js"></script>
    <script src="https://www.gstatic.com/firebasejs/8.10.0/firebase-database.js"></script>

    <script>
        const firebaseConfig = <?php echo json_encode($firebaseConfig); ?>;
        firebase.initializeApp(firebaseConfig);
        const auth = firebase.auth();
        const db = firebase.database();

        // UI Helpers
        const $ = (id) => document.getElementById(id);
        
        // Navigation Logic
        const navItems = document.querySelectorAll('.nav-item:not(.logout-btn)');
        const sections = document.querySelectorAll('.section');

        navItems.forEach(item => {
            item.addEventListener('click', () => {
                navItems.forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                sections.forEach(s => s.classList.remove('active'));
                $(item.dataset.target).classList.add('active');
                if(window.innerWidth < 992) $('sidebar').classList.remove('active');
            });
        });

        $('menuToggle').onclick = () => $('sidebar').classList.toggle('active');

        // Auth Logic
        auth.onAuthStateChanged(user => {
            if (user) {
                $('authOverlay').style.display = 'none';
                $('userEmailDisplay').textContent = user.email;
                initData();
            } else {
                $('authOverlay').style.display = 'flex';
            }
        });

        $('loginBtn').onclick = () => {
            const email = $('adminEmail').value;
            const pass = $('adminPassword').value;
            auth.signInWithEmailAndPassword(email, pass).catch(e => $('authError').textContent = e.message);
        };

        $('logoutBtn').onclick = () => auth.signOut();

        function initData() {
            loadOrders();
            loadDishes();
            loadRestaurants();
        }

        // 1. ORDERS REWRITE
        function loadOrders() {
            db.ref('orders').on('value', snapshot => {
                const container = $('ordersTableBody');
                container.innerHTML = '';
                let revenue = 0, count = 0;

                const orders = [];
                snapshot.forEach(child => { orders.push({id: child.key, ...child.val()}); });
                orders.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));

                orders.forEach(order => {
                    revenue += parseFloat(order.total || 0);
                    count++;
                    const itemsText = order.items ? order.items.map(i => `${i.quantity}x ${i.name}`).join(', ') : 'Empty Order';
                    
                    const status = order.status || 'Placed';
                    const statusClass = status.toLowerCase().includes('delivery') ? 'status-delivery' : 
                                       status.toLowerCase().includes('prep') ? 'status-preparing' :
                                       status.toLowerCase().includes('deliv') ? 'status-delivered' : 'status-placed';

                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td data-label="Order ID" style="font-family:monospace; font-weight:700;">#${order.id.substring(1,7).toUpperCase()}</td>
                        <td data-label="Customer">
                            <div class="customer-info">
                                <span class="name">${order.userEmail || 'Guest'}</span>
                                <span class="phone">${order.phone || 'No Phone'}</span>
                            </div>
                        </td>
                        <td data-label="Items">
                            <div class="item-list">${itemsText}</div>
                        </td>
                        <td data-label="Total" style="font-weight:800; color:var(--primary-dark)">₹${order.total}</td>
                        <td data-label="Status">
                            <select class="status-select ${statusClass}" onchange="updateOrderStatus('${order.id}', this.value)">
                                <option value="Placed" ${status === 'Placed' ? 'selected' : ''}>Placed</option>
                                <option value="Preparing" ${status === 'Preparing' ? 'selected' : ''}>Preparing</option>
                                <option value="Out for Delivery" ${status === 'Out for Delivery' ? 'selected' : ''}>Out for Delivery</option>
                                <option value="Delivered" ${status === 'Delivered' ? 'selected' : ''}>Delivered</option>
                            </select>
                        </td>
                    `;
                    container.appendChild(tr);
                });
                $('stat-revenue').textContent = '₹' + revenue.toLocaleString();
                $('stat-orders').textContent = count;
            });
        }

        window.updateOrderStatus = (id, val) => {
            db.ref('orders/' + id).update({ status: val });
        };

        // 2. DISHES REWRITE
        function loadDishes() {
            db.ref('dishes').on('value', snap => {
                const grid = $('dishesGrid');
                grid.innerHTML = '';
                let c = 0;
                snap.forEach(child => {
                    c++;
                    const item = child.val();
                    grid.innerHTML += `
                        <div class="admin-card">
                            <button class="delete-btn" onclick="deleteItem('dishes','${child.key}')"><i class="fas fa-trash"></i></button>
                            <img src="${item.imageUrl}">
                            <div class="admin-card-body">
                                <h4>${item.name}</h4>
                                <span style="font-weight:800; color:var(--primary)">₹${item.price}</span>
                            </div>
                        </div>
                    `;
                });
                $('stat-dishes').textContent = c;
            });
        }

        // 3. RESTAURANTS
        function loadRestaurants() {
            db.ref('restaurants').on('value', snap => {
                const grid = $('restaurantsGrid');
                grid.innerHTML = '';
                snap.forEach(child => {
                    const item = child.val();
                    grid.innerHTML += `
                        <div class="admin-card">
                            <button class="delete-btn" onclick="deleteItem('restaurants','${child.key}')"><i class="fas fa-trash"></i></button>
                            <img src="${item.imageUrl}">
                            <div class="admin-card-body">
                                <h4>${item.name}</h4>
                                <span style="font-size:0.9rem; font-weight:600;"><i class="fas fa-star" style="color:#f59e0b"></i> ${item.rating}</span>
                            </div>
                        </div>
                    `;
                });
            });
        }

        // CRUD Operations
        window.deleteItem = (path, id) => {
            if(confirm('Delete this item permanently?')) db.ref(`${path}/${id}`).remove();
        };

        // Modals
        const dishM = $('dishModal'), restM = $('restModal');
        $('openDishModal').onclick = () => dishM.style.display = 'flex';
        $('openRestModal').onclick = () => restM.style.display = 'flex';
        document.querySelectorAll('.close-modal').forEach(b => {
            b.onclick = () => { dishM.style.display = 'none'; restM.style.display = 'none'; }
        });

        $('saveDishBtn').onclick = () => {
            const name = $('dishName').value, price = $('dishPrice').value, imageUrl = $('dishImage').value;
            if(name && price && imageUrl) {
                db.ref('dishes').push({name, price, imageUrl}).then(() => {
                    dishM.style.display = 'none';
                    $('dishName').value = ''; $('dishPrice').value = ''; $('dishImage').value = '';
                });
            }
        };

        $('saveRestBtn').onclick = () => {
            const name = $('restName').value, rating = $('restRating').value, imageUrl = $('restImage').value;
            if(name && rating && imageUrl) {
                db.ref('restaurants').push({name, rating, imageUrl}).then(() => {
                    restM.style.display = 'none';
                    $('restName').value = ''; $('restRating').value = ''; $('restImage').value = '';
                });
            }
        };

    </script>
</body>
</html>