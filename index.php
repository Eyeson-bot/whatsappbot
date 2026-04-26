<?php
// --- FIREBASE CONFIGURATION (Moved to PHP) ---

$firebaseConfig = [
  "apiKey" => "YOUR_API_KEY_HERE",
  "authDomain" => "YOUR_PROJECT_ID.firebaseapp.com",
  "databaseURL" => "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  "projectId" => "YOUR_PROJECT_ID",
  "storageBucket" => "YOUR_PROJECT_ID.firebasestorage.app",
  "messagingSenderId" => "YOUR_MESSAGING_SENDER_ID",
  "appId" => "YOUR_APP_ID"
];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    header('Content-Type: application/json');
    
    // Get JSON input
    $input = json_decode(file_get_contents('php://input'), true);

    if (isset($input['email']) && isset($input['otp'])) {
        $to = $input['email'];
        $otp = $input['otp'];

        // ============================================================
        // CONFIGURATION (CREDENTIALS)
        // ============================================================
        $smtp_host = 'smtp.gmail.com'; 
        $smtp_port = 465; 
        $username  = 'saiyedkhan212@gmail.com'; 
        $password  = 'kzjlqgccbfrkhqsb';          
        // ============================================================

        $subject = "Your JavaGoat Verification Code";
        $message_body = "Your OTP Code is: " . $otp;

        $result = send_smtp_mail($to, $subject, $message_body, $username, $password, $smtp_host, $smtp_port);

        if ($result === true) {
            echo json_encode(["status" => "success"]);
        } else {
            echo json_encode(["status" => "error", "message" => $result]);
        }
    } else {
        echo json_encode(["status" => "error", "message" => "Invalid input"]);
    }
    exit;
}

// --- SMTP Function with Security Checks Removed for Web Hosting ---
function send_smtp_mail($to, $subject, $body, $user, $pass, $host, $port) {
    $context = stream_context_create([
        'ssl' =>[
            'verify_peer' => false,
            'verify_peer_name' => false,
            'allow_self_signed' => true
        ]
    ]);

    $socket = stream_socket_client("ssl://{$host}:{$port}", $errno, $errstr, 15, STREAM_CLIENT_CONNECT, $context);
    
    if (!$socket) return "Connection failed: $errstr ($errno)";

    function read_server($socket) { 
        $response = "";
        while($str = fgets($socket, 515)) {
            $response .= $str;
            if(substr($str, 3, 1) == " ") break;
        }
        return $response;
    }
    read_server($socket);

    fputs($socket, "EHLO {$host}\r\n"); read_server($socket);
    fputs($socket, "AUTH LOGIN\r\n"); read_server($socket);
    fputs($socket, base64_encode($user) . "\r\n"); read_server($socket);
    fputs($socket, base64_encode($pass) . "\r\n"); read_server($socket); 

    fputs($socket, "MAIL FROM: <{$user}>\r\n"); read_server($socket);
    fputs($socket, "RCPT TO: <{$to}>\r\n"); read_server($socket);
    fputs($socket, "DATA\r\n"); read_server($socket);

    $headers  = "MIME-Version: 1.0\r\n";
    $headers .= "Content-Type: text/plain; charset=UTF-8\r\n";
    $headers .= "From: JavaGoat <{$user}>\r\n";
    $headers .= "To: <{$to}>\r\n";
    $headers .= "Subject: {$subject}\r\n";

    fputs($socket, "$headers\r\n$body\r\n.\r\n"); 
    read_server($socket);

    fputs($socket, "QUIT\r\n"); 
    fclose($socket);

    return true; 
}
?>

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>JavaGoat</title>
    <!-- Fonts & Icons -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.1.1/css/all.min.css">
    <!-- Leaflet CSS -->
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.7.1/dist/leaflet.css" />

    <style>
        :root {
            /* NEW MODERN THEME: Emerald Green & Deep Slate */
            --primary-color: #10b981; 
            --primary-gradient: linear-gradient(135deg, #10b981 0%, #059669 100%);
            --secondary-color: #f8fafc; /* Very soft off-white */
            --text-color: #1e293b; /* Deep slate for text */
            --light-text: #64748b;
            --border-color: #e2e8f0;
            --white: #ffffff;
            --danger: #ef4444; 
            --success: #10b981;
            --card-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05);
        }

        body {
            margin: 0;
            font-family: 'Poppins', sans-serif;
            background-color: #0f172a; /* Dark background framing the app */
            display: flex; justify-content: center; align-items: center;
            min-height: 100vh; color: var(--text-color);
        }

        .mobile-container {
            width: 100%; max-width: 414px; height: 100vh; max-height: 896px;
            background-color: var(--secondary-color);
            border-radius: 0px; 
            overflow: hidden; position: relative; display: flex; flex-direction: column;
        }
        
        @media (min-width: 420px) {
            .mobile-container {
                border-radius: 30px;
                box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
                height: 90vh;
                border: 8px solid #1e293b; /* Premium device border */
            }
        }

        .page {
            position: absolute; top: 0; left: 0; right: 0; bottom: 0;
            opacity: 0; visibility: hidden;
            transition: opacity 0.3s ease, visibility 0.3s ease;
            background-color: var(--secondary-color);
            display: flex; flex-direction: column; z-index: 1;
        }
        .page.active { opacity: 1; visibility: visible; z-index: 5; }

        /* --- LOGIN/REGISTER UI --- */
        .auth-content {
            width: 100%; height: 100%;
            display: flex; flex-direction: column; justify-content: center; align-items: center;
            padding: 20px; box-sizing: border-box; background: var(--secondary-color);
        }

        .auth-card {
            background: white; width: 100%; border-radius: 24px;
            box-shadow: var(--card-shadow); border: 1px solid var(--border-color);
            overflow: hidden; animation: fadeIn 0.5s ease-out; position: relative;
        }
        
        @keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }

        .auth-card::before {
            content: ''; position: absolute; top: 0; left: 0; right: 0;
            height: 5px; background: var(--primary-gradient);
        }

        .auth-header { text-align: center; padding: 40px 30px 10px 30px; }
        .logo-circle {
            width: 70px; height: 70px; margin: 0 auto 15px auto;
            background: #ecfdf5; color: var(--primary-color);
            border-radius: 20px; /* Squircle */
            display: flex; align-items: center; justify-content: center;
            font-size: 2em; box-shadow: 0 8px 15px rgba(16, 185, 129, 0.15);
        }
        .auth-header h1 { font-size: 1.8em; margin: 0; color: var(--text-color); font-weight: 800; letter-spacing: -0.5px;}
        .auth-header p { color: var(--light-text); font-size: 0.9em; margin-top: 5px; }

        .auth-body { padding: 30px; }

        .input-label { font-size: 0.75em; color: var(--light-text); font-weight: 700; margin-bottom: 5px; display: block; margin-left: 5px; text-transform: uppercase; letter-spacing: 1px;}
        .input-group { position: relative; margin-bottom: 20px; }
        .input-group i {
            position: absolute; top: 43px; left: 18px; transform: translateY(-50%);
            color: #94a3b8; transition: color 0.3s;
        }
        
        .auth-input {
            width: 100%; padding: 16px 16px 16px 50px;
            background: #f1f5f9; border: 2px solid transparent;
            border-radius: 16px; font-size: 1em;
            outline: none; transition: all 0.3s; box-sizing: border-box; font-family: 'Poppins', sans-serif; color: var(--text-color); font-weight: 500;
        }
        .auth-input:focus {
            background: #ffffff; border-color: var(--primary-color);
            box-shadow: 0 4px 15px rgba(16, 185, 129, 0.1);
        }
        .auth-input:focus + i { color: var(--primary-color); } 

        .btn-main {
            width: 100%; padding: 18px;
            background: var(--primary-gradient);
            color: var(--white); border: none; border-radius: 16px;
            font-size: 1.1em; font-weight: 600; cursor: pointer;
            box-shadow: 0 8px 20px rgba(16, 185, 129, 0.3);
            margin-bottom: 15px; transition: all 0.2s; letter-spacing: 0.5px;
        }
        .btn-main:active { transform: scale(0.97); }
        .btn-main:disabled { background: #cbd5e1; cursor: not-allowed; box-shadow: none; opacity: 0.8; }

        .btn-google {
            background: white; color: var(--text-color); border: 2px solid #f1f5f9;
            box-shadow: none; display: flex; align-items: center; justify-content: center; gap: 10px;
        }
        
        .auth-switch { text-align: center; margin-top: 15px; font-size: 0.9em; color: var(--light-text); }
        .auth-switch a { color: var(--primary-color); font-weight: 600; text-decoration: none; }
        
        #auth-error { 
            color: var(--danger); text-align: center; margin-bottom: 15px; 
            font-size: 0.9em; background: #fef2f2; padding: 12px; border-radius: 12px; border: 1px solid #fecaca;
            display: none; font-weight: 500;
        }

        /* --- Header --- */
        .app-header {
            background: var(--primary-gradient);
            padding: 55px 25px 25px 25px; color: var(--white);
            border-bottom-left-radius: 35px; border-bottom-right-radius: 35px;
            box-shadow: 0 10px 25px rgba(16, 185, 129, 0.2);
        }
        .header-top { display: flex; justify-content: space-between; align-items: center; }
        .header-top h1 { font-size: 1.6em; margin: 0; font-weight: 800; display:flex; align-items:center; letter-spacing: -0.5px;}
        .user-greeting { font-size: 0.9em; font-weight: 500; opacity: 0.9; text-align: right; background: rgba(255,255,255,0.2); padding: 5px 12px; border-radius: 20px;}
        
        .search-bar { margin-top: 20px; position: relative; }
        .search-bar input {
            width: 100%; padding: 16px 20px 16px 50px; border: none;
            border-radius: 16px; font-size: 1em; box-sizing: border-box;
            box-shadow: 0 8px 20px rgba(0,0,0,0.1); outline: none; font-family: 'Poppins', sans-serif;
        }
        .search-bar .fa-search {
            position: absolute; left: 20px; top: 50%;
            transform: translateY(-50%); color: #94a3b8; font-size: 1.1em;
        }

        /* --- Main Content --- */
        main { flex: 1; overflow-y: auto; padding: 0 20px 100px 20px; }
        
        .category-section { display: flex; justify-content: space-between; padding: 25px 5px; }
        .category-item { text-align: center; cursor: pointer; transition: transform 0.2s; }
        .category-item:active { transform: scale(0.9); }
        
        .category-icon {
            width: 60px; height: 60px; 
            border-radius: 20px; /* Squircle */
            display: flex; justify-content: center; align-items: center;
            box-shadow: 0 8px 15px rgba(0,0,0,0.04); 
            margin-bottom: 10px; font-size: 1.5em; background: white; border: 1px solid var(--border-color);
        }

        /* Updated Category Colors to fit modern theme */
        .category-item:nth-child(1) .category-icon { color: #ef4444; }
        .category-item:nth-child(2) .category-icon { color: #eab308; }
        .category-item:nth-child(3) .category-icon { color: #8b5cf6; }
        .category-item:nth-child(4) .category-icon { color: #ec4899; }
        .category-item p { margin: 0; font-weight: 600; font-size: 0.85em; color: var(--text-color); }

        .section-title { font-size: 1.3em; font-weight: 800; margin: 25px 0 15px 0; color: var(--text-color); letter-spacing: -0.5px;}
        .horizontal-scroll { display: flex; overflow-x: auto; padding-bottom: 25px; gap: 18px; scroll-behavior: smooth; margin: 0 -5px; padding: 5px; }
        .horizontal-scroll::-webkit-scrollbar { display: none; }

        .promo-banner {
            width: 100%; height: 150px; 
            background: linear-gradient(135deg, #1e293b, #0f172a);
            border-radius: 24px; margin-top: 15px;
            display: flex; align-items: center; justify-content: space-between;
            padding: 0 30px; box-sizing: border-box; color: white;
            box-shadow: 0 15px 30px rgba(15, 23, 42, 0.2); position: relative; overflow: hidden;
        }
        .promo-content h3 { margin: 0; font-size: 1.6em; font-weight: 800; color: #10b981;}
        .promo-content p { margin: 5px 0 0 0; font-size: 0.95em; opacity: 0.9; line-height: 1.4;}
        .promo-banner img { height: 140%; position: absolute; right: -20px; bottom: -25px; transform: rotate(-10deg); filter: drop-shadow(0 10px 10px rgba(0,0,0,0.3));}

        .card {
            flex-shrink: 0; width: 160px; background-color: var(--white);
            border-radius: 20px; box-shadow: var(--card-shadow); border: 1px solid var(--border-color);
            overflow: hidden; position: relative;
        }
        .card img { width: 100%; height: 120px; object-fit: cover; }
        .card-content { padding: 15px; }
        .card-content h3 { margin: 0 0 5px 0; font-size: 1em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 700; color: var(--text-color);}
        .card-content p { color: var(--primary-color); font-weight: 800; font-size: 1em; margin: 0;}
        
        .add-btn {
            background-color: var(--primary-color); color: var(--white);
            border: none; border-radius: 12px; width: 36px; height: 36px;
            cursor: pointer; position: absolute; bottom: 12px; right: 12px;
            display: flex; align-items: center; justify-content: center;
            box-shadow: 0 6px 15px rgba(16, 185, 129, 0.4); transition: transform 0.2s;
        }
        .add-btn:active { transform: scale(0.9); }

        /* --- UPDATED SLEEK SLATE NAV & FLOATING CART --- */
        nav {
            position: absolute; bottom: 0; left: 0; right: 0;
            height: 75px; 
            background: #1e293b; /* Deep Premium Slate */
            display: flex; justify-content: space-between; align-items: center;
            box-shadow: 0 -10px 30px rgba(0,0,0,0.1);
            border-radius: 35px 35px 0 0; z-index: 10;
            padding: 0 35px; 
        }
        
        .nav-item {
            display: flex; flex-direction: column; align-items: center;
            color: #64748b; /* Muted slate for inactive */
            cursor: pointer; position: relative;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        
        .nav-item.active { 
            color: var(--primary-color); /* Emerald Green */
            transform: translateY(-5px); 
        } 
        
        .nav-item i { font-size: 1.5em; margin-bottom: 4px; transition: transform 0.3s;}
        .nav-item.active i { transform: scale(1.1); filter: drop-shadow(0 2px 5px rgba(16, 185, 129, 0.3));}
        .nav-item p { margin: 0; font-size: 0.75em; font-weight: 600;}

        /* Floating Cart Button */
        #cart-fab-container {
            position: fixed;
            bottom: 90px; 
            right: 25px;
            z-index: 100;
        }
        .fab-btn {
            width: 65px; height: 65px;
            background: var(--primary-gradient);
            border-radius: 20px; /* Squircle */
            display: flex; justify-content: center; align-items: center;
            color: var(--white); font-size: 1.6em;
            box-shadow: 0 10px 25px rgba(16, 185, 129, 0.4);
            cursor: pointer; position: relative;
            transition: transform 0.2s;
        }
        .fab-btn:active { transform: scale(0.9); }
        
        #cart-count {
            position: absolute; top: -5px; right: -5px;
            background-color: var(--danger); color: white;
            border-radius: 50%; width: 24px; height: 24px;
            font-size: 0.85em; display: flex; justify-content: center; align-items: center; font-weight: 800;
            box-shadow: 0 4px 10px rgba(239, 68, 68, 0.4);
            border: 2px solid white;
        }

        /* --- Other Pages --- */
        .page-header { padding: 50px 20px 25px 20px; text-align: center; position: relative; background: var(--secondary-color); border-bottom: 1px solid var(--border-color);}
        .page-header h2 { margin: 0; font-size: 1.4em; color: var(--text-color); font-weight: 800; letter-spacing: -0.5px;}
        .back-btn { position: absolute; left: 20px; top: 52px; font-size: 1.3em; cursor: pointer; color: var(--text-color); padding: 5px; background: white; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); border: 1px solid var(--border-color); width: 35px; height: 35px; display: flex; justify-content: center; align-items: center;}

        .cart-item {
            display: flex; align-items: center; background: var(--white);
            padding: 15px; border-radius: 20px; margin-bottom: 15px;
            box-shadow: var(--card-shadow); border: 1px solid var(--border-color);
        }
        .cart-item img { width: 70px; height: 70px; border-radius: 14px; object-fit: cover; margin-right: 15px; }
        .cart-item h4 { margin: 0 0 5px 0; font-size: 1.05em; color: var(--text-color);}
        .cart-item p { margin: 0; font-weight: 700; color: var(--primary-color);}
        .qty-controls { display: flex; align-items: center; gap: 10px; background: #f1f5f9; padding: 6px 12px; border-radius: 12px;}
        .qty-controls button {
            background: white; border: none; width: 28px; height: 28px; border-radius: 8px; cursor: pointer;
            box-shadow: 0 2px 5px rgba(0,0,0,0.05); color: var(--text-color); font-weight: bold; font-size: 1.1em;
        }
        .qty-controls span { font-weight: 700; width: 15px; text-align: center; }

        #map-container {
            height: 220px; width: 100%; border-radius: 20px;
            overflow: hidden; margin-top: 15px; margin-bottom: 15px;
            border: 2px solid var(--primary-color); display: none; box-shadow: var(--card-shadow);
        }
        .location-btn {
            background-color: #3b82f6; color: var(--white);
            width: 100%; padding: 16px; border-radius: 16px; border: none;
            cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 10px;
            font-weight: 600; margin-bottom: 10px; transition: background 0.3s; box-shadow: 0 8px 20px rgba(59, 130, 246, 0.2); font-size: 1em;
        }
        
        .form-group { margin-bottom: 25px; }
        .form-group label { display: block; margin-bottom: 10px; font-weight: 700; color: var(--text-color); font-size: 0.9em; text-transform: uppercase; letter-spacing: 0.5px;}
        .form-control {
            width: 100%; padding: 16px; border: 2px solid var(--border-color);
            border-radius: 16px; box-sizing: border-box; font-family: inherit; background: #fff; font-size: 1em; color: var(--text-color); font-weight: 500; transition: border-color 0.3s;
        }
        .form-control:focus { border-color: var(--primary-color); outline: none; }

        .otp-group { display: flex; gap: 10px; margin-top: 10px; display: none; }
        .verify-btn {
            background-color: #1e293b; color: white; border: none;
            padding: 0 25px; border-radius: 14px; cursor: pointer; white-space: nowrap; font-weight: 600;
        }
        .verified-badge {
            color: var(--success); font-weight: 700; display: none; align-items: center; gap: 8px; margin-top: 10px; background: #ecfdf5; padding: 10px 15px; border-radius: 12px; width: fit-content; border: 1px solid #a7f3d0;
        }
        .or-divider {
            display: flex; align-items: center; text-align: center; color: #94a3b8;
            margin: 30px 0; font-weight: 700; font-size: 0.85em; letter-spacing: 2px;
        }
        .or-divider::before, .or-divider::after { content: ''; flex: 1; border-bottom: 1px solid var(--border-color); }
        .or-divider::before { margin-right: 15px; } .or-divider::after { margin-left: 15px; }

        .order-card {
            background: var(--white); border-radius: 24px; padding: 25px;
            margin-bottom: 20px; box-shadow: var(--card-shadow); border: 1px solid var(--border-color);
        }
        .track-bar { display: flex; justify-content: space-between; position: relative; margin-top: 30px; }
        .track-bar::before {
            content: ''; position: absolute; top: 10px; left: 0; right: 0;
            height: 4px; background: #f1f5f9; z-index: 1; border-radius: 2px;
        }
        .track-step { position: relative; z-index: 2; display: flex; flex-direction: column; align-items: center; width: 25%; }
        .dot {
            width: 20px; height: 20px; background: #e2e8f0; border-radius: 50%;
            border: 4px solid var(--white); transition: all 0.3s; box-shadow: 0 2px 5px rgba(0,0,0,0.1);
        }
        .track-step p { font-size: 0.7em; margin-top: 10px; color: #94a3b8; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;}
        .track-step.active .dot { background: var(--primary-color); transform: scale(1.3); border-color: #ecfdf5; box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.2);}
        .track-step.active p { color: var(--primary-color); }
        .track-step.passed .dot { background: var(--primary-color); border-color: var(--primary-color);}
        .track-step.passed p { color: var(--primary-color); }

        .notification-card {
            background: white; border-radius: 20px; padding: 18px;
            margin-bottom: 15px; box-shadow: var(--card-shadow); border: 1px solid var(--border-color);
            display: flex; align-items: flex-start;
        }
        .notif-icon-box {
            width: 45px; height: 45px; background: #ecfdf5;
            color: var(--primary-color); border-radius: 14px;
            display: flex; justify-content: center; align-items: center;
            margin-right: 15px; font-size: 1.2em; flex-shrink: 0;
        }
        .notif-content h4 { margin: 0 0 5px 0; color: var(--text-color); font-weight: 700;}
        .notif-content p { margin: 0 0 8px 0; color: var(--light-text); font-size: 0.9em; line-height: 1.4;}
        .notif-time { font-size: 0.75em; color: #94a3b8; font-weight: 600;}

    </style>
</head>
<body>

    <div class="mobile-container">

        <!-- DETAILED LOGIN PAGE (No Background Image) -->
        <div id="loginPage" class="page active">
            <div class="auth-content">
                <div class="auth-card">
                    <div class="auth-header">
                        <div class="logo-circle"><i class="fas fa-leaf"></i></div>
                        <h1>Welcome Back</h1>
                        <p>Sign in to continue to JavaGoat</p>
                    </div>
                    
                    <div class="auth-body">
                        <p id="auth-error"></p>
                        
                        <div class="input-group">
                            <label class="input-label">EMAIL ADDRESS</label>
                            <input type="email" id="loginEmail" class="auth-input" placeholder="name@example.com">
                            <i class="fas fa-envelope"></i>
                        </div>
                        <div class="input-group">
                            <label class="input-label">PASSWORD</label>
                            <input type="password" id="loginPassword" class="auth-input" placeholder="鈥⑩€⑩€⑩€⑩€⑩€⑩€⑩€�">
                            <i class="fas fa-lock"></i>
                        </div>
                        
                        <button class="btn-main" id="loginBtn">Login</button>
                        <button class="btn-main btn-google" id="googleBtn">
                            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="G" width="20"> 
                            Sign in with Google
                        </button>
                        
                        <div class="auth-switch">
                            Don't have an account? <a href="#" id="gotoRegister">Register</a>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- DETAILED REGISTER PAGE -->
        <div id="registerPage" class="page">
             <div class="auth-content">
                <div class="auth-card">
                    <div class="auth-header">
                        <div class="logo-circle"><i class="fas fa-user-plus"></i></div>
                        <h1>Create Account</h1>
                        <p>Join the JavaGoat community</p>
                    </div>
                    
                    <div class="auth-body">
                        <div class="input-group">
                            <label class="input-label">FULL NAME</label>
                            <input type="text" id="regName" class="auth-input" placeholder="John Doe">
                            <i class="fas fa-user"></i>
                        </div>
                        <div class="input-group">
                            <label class="input-label">EMAIL ADDRESS</label>
                            <input type="email" id="registerEmail" class="auth-input" placeholder="name@example.com">
                            <i class="fas fa-envelope"></i>
                        </div>
                        <div class="input-group">
                            <label class="input-label">PASSWORD</label>
                            <input type="password" id="registerPassword" class="auth-input" placeholder="鈥⑩€⑩€⑩€⑩€⑩€⑩€⑩€�">
                            <i class="fas fa-lock"></i>
                        </div>
                        
                        <button class="btn-main" id="registerBtn">Sign Up</button>
                        
                        <div class="auth-switch">
                            Already have an account? <a href="#" id="gotoLogin">Login</a>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- HOME -->
        <div id="appContainer" class="page">
            <header class="app-header">
                <div class="header-top">
                    <h1><i class="fas fa-leaf" style="margin-right:10px;"></i> JavaGoat</h1>
                    <div class="user-greeting" id="userGreeting">Hello, Guest</div>
                </div>
                <div class="search-bar">
                    <i class="fas fa-search"></i>
                    <input type="text" placeholder="What are you craving?">
                </div>
            </header>

            <main>
                <section class="category-section">
                    <div class="category-item"><div class="category-icon"><i class="fas fa-pizza-slice"></i></div><p>Pizza</p></div>
                    <div class="category-item"><div class="category-icon"><i class="fas fa-hamburger"></i></div><p>Burger</p></div>
                    <div class="category-item"><div class="category-icon"><i class="fas fa-coffee"></i></div><p>Coffee</p></div>
                    <div class="category-item"><div class="category-icon"><i class="fas fa-ice-cream"></i></div><p>Sweet</p></div>
                </section>

                <h2 class="section-title">Popular Restaurants</h2>
                <div class="horizontal-scroll" id="restaurantsContainer"></div>

                <div class="promo-banner">
                    <div class="promo-content">
                        <h3>50% OFF</h3>
                        <p>On your first order today!</p>
                    </div>
                    <img src="https://cdn-icons-png.flaticon.com/512/3075/3075977.png" alt="Burger">
                </div>

                <h2 class="section-title">Recommended Dishes</h2>
                <div class="horizontal-scroll" id="dishesContainer"></div>
            </main>

            <!-- Floating Cart Button -->
            <div id="cart-fab-container">
                <div class="fab-btn" data-page="cartPage">
                    <i class="fas fa-shopping-bag"></i>
                    <div id="cart-count">0</div>
                </div>
            </div>

            <!-- SLATE NAV BAR -->
            <nav>
                <div class="nav-item active" data-page="appContainer"><i class="fas fa-home"></i><p>Home</p></div>
                <div class="nav-item" data-page="ordersPage" id="ordersNavBtn"><i class="fas fa-receipt"></i><p>Orders</p></div>
                <div class="nav-item" data-page="notificationsPage" id="notifNavBtn"><i class="fas fa-bell"></i><p>Alerts</p></div>
                <div class="nav-item" id="logoutBtn"><i class="fas fa-sign-out-alt"></i><p>Logout</p></div>
            </nav>
        </div>

        <!-- CART -->
        <div id="cartPage" class="page">
            <header class="page-header">
                <div class="back-btn" data-target="appContainer"><i class="fas fa-chevron-left"></i></div>
                <h2>My Cart</h2>
            </header>
            <div style="flex:1; padding:20px; overflow-y:auto;" id="cart-content-area">
                <div id="cartItemsContainer"></div>
                <div id="cart-summary" style="margin-top:30px; border-top:2px dashed var(--border-color); padding-top:25px;">
                    <div style="display:flex; justify-content:space-between; margin-bottom:12px; font-weight:500; color:var(--light-text);"><span>Subtotal</span><span id="subtotal-price" style="color:var(--text-color);">鈧�0.00</span></div>
                    <div style="display:flex; justify-content:space-between; margin-bottom:12px; font-weight:500; color:var(--light-text);"><span>Delivery Fee</span><span style="color:var(--text-color);">鈧�50.00</span></div>
                    <div style="display:flex; justify-content:space-between; font-weight:800; font-size:1.5em; color:var(--primary-color); margin-top:15px;"><span>Total</span><span id="total-price">鈧�50.00</span></div>
                    <button class="btn-main" id="goToCheckoutBtn" style="margin-top:30px;">Proceed to Checkout</button>
                </div>
            </div>
        </div>

        <!-- CHECKOUT -->
        <div id="checkoutPage" class="page">
            <header class="page-header">
                <div class="back-btn" data-target="cartPage"><i class="fas fa-chevron-left"></i></div>
                <h2>Checkout</h2>
            </header>
            <div style="flex:1; padding:25px 20px; overflow-y:auto;">
                
                <div class="form-group">
                    <label>Delivery Location</label>
                    <button class="location-btn" id="geoBtn">
                        <i class="fas fa-location-arrow"></i> Use My Current Location
                    </button>
                    <div id="map-container"><div id="map" style="height:100%; width:100%;"></div></div>
                    <input type="text" id="addressText" class="form-control" placeholder="House/Flat No., Landmark">
                    <input type="hidden" id="lat"><input type="hidden" id="lng">
                </div>

                 <div class="form-group">
                    <label>Phone Number</label>
                    <input type="tel" id="contactPhone" class="form-control" placeholder="Mobile Number">
                </div>

                <div class="or-divider">VERIFICATION</div>

                <div class="form-group">
                    <label>Email Verification (Optional)</label>
                    <div style="display: flex; gap: 10px;">
                        <input type="email" id="verifyEmail" class="form-control" readonly style="margin-bottom:0; background:#f1f5f9; color:#94a3b8; border-color:transparent;">
                        <button class="verify-btn" id="sendOtpBtn">Send OTP</button>
                    </div>
                    
                    <div class="otp-group" id="otpSection">
                        <input type="text" id="otpCode" class="form-control" placeholder="6-digit code" style="margin-bottom:0;">
                        <button class="verify-btn" id="verifyOtpBtn" style="background:var(--success);">Verify</button>
                    </div>

                    <div id="verifiedBadge" class="verified-badge">
                        <i class="fas fa-check-circle"></i> Verified Successfully
                    </div>
                    <p id="otpMsg" style="font-size:0.85em; color:var(--light-text); margin-top:8px; font-weight:500;"></p>
                </div>

                <div class="form-group" style="margin-top:30px;">
                    <label>Payment Method</label>
                    <div style="padding:18px; background:white; border:2px solid var(--primary-color); border-radius:16px; display:flex; align-items:center; box-shadow: 0 4px 15px rgba(16, 185, 129, 0.1);">
                        <i class="fas fa-money-bill-wave" style="color:var(--primary-color); margin-right:15px; font-size:1.5em;"></i>
                        <span style="font-weight:700; color:var(--text-color);">Cash on Delivery</span>
                        <i class="fas fa-check-circle" style="color:var(--primary-color); margin-left:auto; font-size:1.2em;"></i>
                    </div>
                </div>

                <button class="btn-main" id="placeOrderBtn" disabled style="margin-top:20px;">Enter Phone OR Verify Email</button>
            </div>
        </div>

        <!-- ORDERS -->
        <div id="ordersPage" class="page">
            <header class="page-header">
                <div class="back-btn" data-target="appContainer"><i class="fas fa-chevron-left"></i></div>
                <h2>My Orders</h2>
            </header>
            <div style="flex:1; padding:20px; overflow-y:auto;" id="ordersListContainer"></div>
        </div>

        <!-- NOTIFICATIONS -->
        <div id="notificationsPage" class="page">
            <header class="page-header">
                <div class="back-btn" data-target="appContainer"><i class="fas fa-chevron-left"></i></div>
                <h2>Notifications</h2>
            </header>
            <div style="flex:1; padding:20px; overflow-y:auto;" id="notificationListContainer">
                <p style="text-align:center; color:#94a3b8; font-weight:500; margin-top:50px;">Loading...</p>
            </div>
        </div>

        <!-- THANK YOU -->
        <div id="thankYouPage" class="page">
            <div style="display:flex; flex-direction:column; justify-content:center; align-items:center; height:100%; padding:40px; text-align:center;">
                <div style="width:110px; height:110px; background:#ecfdf5; border-radius:30px; display:flex; justify-content:center; align-items:center; margin-bottom:25px; box-shadow: 0 10px 25px rgba(16, 185, 129, 0.2);">
                    <i class="fas fa-check" style="font-size:3.5em; color:var(--primary-color);"></i>
                </div>
                <h2 style="color:var(--text-color); font-weight:800; font-size:2em; margin-bottom:10px;">Order Placed!</h2>
                <p style="color:var(--light-text); font-size:1.1em; font-weight:500;">Your food is being prepared.</p>
                <button class="btn-main" id="trackOrderBtn" style="margin-top:40px;">Track Order</button>
                <a href="#" id="backToHomeBtn" style="margin-top:20px; display:block; color:var(--light-text); text-decoration:none; font-weight:600; font-size:1.1em;">Back to Home</a>
            </div>
        </div>

    </div>

    <!-- Firebase -->
    <script src="https://www.gstatic.com/firebasejs/8.10.0/firebase-app.js"></script>
    <script src="https://www.gstatic.com/firebasejs/8.10.0/firebase-auth.js"></script>
    <script src="https://www.gstatic.com/firebasejs/8.10.0/firebase-database.js"></script>
    <!-- Leaflet -->
    <script src="https://unpkg.com/leaflet@1.7.1/dist/leaflet.js"></script>

    <script>
        // --- Firebase Config injected from PHP ---
        const firebaseConfig = <?php echo json_encode($firebaseConfig); ?>;
        
        firebase.initializeApp(firebaseConfig);
        const auth = firebase.auth();
        const db = firebase.database();
        const googleProvider = new firebase.auth.GoogleAuthProvider();

        let cart = [];
        let currentUser = null;
        let map, marker;
        let allDishesData =[]; 
        let ordersListener = null;

        // --- OTP & Validation State ---
        let isVerified = false;
        let generatedOTP = null;

        // --- Navigation ---
        const showPage = (id) => {
            document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === id));
            if(id === 'checkoutPage') {
                setTimeout(() => { if(map) map.invalidateSize(); }, 300);
                if(currentUser) document.getElementById('verifyEmail').value = currentUser.email;
                checkOrderValidity(); // Check button state on load
            }
            if(id === 'ordersPage') loadOrders();
            if(id === 'notificationsPage') loadNotifications();
        };

        document.querySelectorAll('[data-target], [data-page]').forEach(b => 
            b.addEventListener('click', (e) => {
                const target = e.currentTarget.dataset.target || e.currentTarget.dataset.page;
                if(target) showPage(target);
            })
        );
        document.getElementById('gotoRegister').onclick = () => showPage('registerPage');
        document.getElementById('gotoLogin').onclick = () => showPage('loginPage');
        document.getElementById('logoutBtn').onclick = () => { auth.signOut(); cart=[]; updateCartUI(); };
        document.getElementById('goToCheckoutBtn').onclick = () => showPage('checkoutPage');
        document.getElementById('trackOrderBtn').onclick = () => showPage('ordersPage');
        document.getElementById('backToHomeBtn').onclick = () => showPage('appContainer');

        // --- Auth & Initial Data ---
        auth.onAuthStateChanged(u => {
            if(u) { 
                currentUser = u; 
                showPage('appContainer'); 
                fetchData();
                listenForStatusUpdates(); // Start watching for tracking updates
                const name = u.displayName ? u.displayName.split(' ')[0] : 'Guest';
                document.getElementById('userGreeting').innerHTML = `Hello, ${name}`;
            }
            else { currentUser = null; showPage('loginPage'); }
        });

        const showError = (msg) => {
            const err = document.getElementById('auth-error');
            err.textContent = msg;
            err.style.display = 'block';
        }

        document.getElementById('loginBtn').onclick = () => auth.signInWithEmailAndPassword(
            document.getElementById('loginEmail').value, document.getElementById('loginPassword').value
        ).catch(e => showError(e.message));

        document.getElementById('googleBtn').onclick = () => auth.signInWithPopup(googleProvider).catch(e => showError(e.message));

        document.getElementById('registerBtn').onclick = () => {
            const email = document.getElementById('registerEmail').value;
            const pass = document.getElementById('registerPassword').value;
            const name = document.getElementById('regName').value;
            auth.createUserWithEmailAndPassword(email, pass)
                .then((userCred) => userCred.user.updateProfile({ displayName: name }))
                .catch(e => showError(e.message));
        };

        // --- EMAIL SENDING LOGIC ---
        document.getElementById('sendOtpBtn').onclick = () => {
            const email = document.getElementById('verifyEmail').value;
            const msg = document.getElementById('otpMsg');
            if(!email) { alert("No email found."); return; }
            generatedOTP = Math.floor(100000 + Math.random() * 900000);
            msg.style.color = '#3b82f6';
            msg.textContent = "Sending OTP...";
            
            fetch(window.location.href, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email, otp: generatedOTP }),
            })
            .then(response => response.json())
            .then(data => {
                if(data.status === "success") {
                    msg.style.color = 'var(--primary-color)';
                    msg.textContent = "OTP Sent to " + email;
                    document.getElementById('otpSection').style.display = 'flex';
                    document.getElementById('sendOtpBtn').style.display = 'none';
                } else {
                    msg.style.color = '#eab308';
                    console.log("Mail Error: ", data.message);
                    alert("Email service is busy. Here is a test code: " + generatedOTP); 
                    document.getElementById('otpSection').style.display = 'flex';
                    document.getElementById('sendOtpBtn').style.display = 'none';
                }
            })
            .catch((error) => {
                alert("Network error. Here is a test code: " + generatedOTP);
                document.getElementById('otpSection').style.display = 'flex';
                document.getElementById('sendOtpBtn').style.display = 'none';
            });
        };

        document.getElementById('verifyOtpBtn').onclick = () => {
            const code = document.getElementById('otpCode').value;
            const msg = document.getElementById('otpMsg');
            if(code == generatedOTP) {
                isVerified = true;
                document.getElementById('otpSection').style.display = 'none';
                document.getElementById('verifiedBadge').style.display = 'flex';
                msg.textContent = "";
                checkOrderValidity();
            } else {
                msg.style.color = 'var(--danger)';
                msg.textContent = "Incorrect OTP code.";
            }
        };

        // --- Validation Logic ---
        const phoneInput = document.getElementById('contactPhone');
        const orderBtn = document.getElementById('placeOrderBtn');
        phoneInput.addEventListener('input', checkOrderValidity);

        function checkOrderValidity() {
            const phoneVal = phoneInput.value.trim();
            if (phoneVal.length > 5 || isVerified) {
                orderBtn.disabled = false;
                orderBtn.style.opacity = '1';
                orderBtn.textContent = "Confirm Order";
            } else {
                orderBtn.disabled = true;
                orderBtn.style.opacity = '0.6';
                orderBtn.textContent = "Enter Phone OR Verify Email";
            }
        }

        // --- Map ---
        document.getElementById('geoBtn').addEventListener('click', () => {
            const btn = document.getElementById('geoBtn');
            document.getElementById('map-container').style.display = 'block';
            if(!map) {
                map = L.map('map').setView([51.505, -0.09], 13);
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
                map.on('click', (e) => handleLocationUpdate(e.latlng.lat, e.latlng.lng));
            }
            map.invalidateSize();
            if (navigator.geolocation) {
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Locating...';
                navigator.geolocation.getCurrentPosition(
                    (p) => {
                        handleLocationUpdate(p.coords.latitude, p.coords.longitude);
                        map.setView([p.coords.latitude, p.coords.longitude], 16);
                        btn.innerHTML = '<i class="fas fa-check"></i> Location Set';
                    },
                    (e) => { alert("Permission denied."); btn.innerHTML = 'Use My Current Location'; }
                );
            }
        });

        function handleLocationUpdate(lat, lng) {
            if(marker) map.removeLayer(marker);
            marker = L.marker([lat, lng]).addTo(map);
            document.getElementById('lat').value = lat;
            document.getElementById('lng').value = lng;
            const addr = document.getElementById('addressText');
            addr.value = "Fetching address...";
            fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`)
                .then(r => r.json())
                .then(d => {
                     addr.value = `${d.locality || d.city || ''}, ${d.principalSubdivision || ''}, ${d.countryName || ''}`;
                }).catch(() => addr.value = "");
        }

        // --- Data & Search ---
        function fetchData() {
            db.ref('restaurants').once('value', s => {
                const c = document.getElementById('restaurantsContainer'); c.innerHTML='';
                s.forEach(r => {
                    c.innerHTML += `<div class="card"><img src="${r.val().imageUrl}"><div class="card-content"><h3>${r.val().name}</h3><p><i class="fas fa-star" style="color:#f59e0b"></i> ${r.val().rating}</p></div></div>`;
                });
            });
            db.ref('dishes').once('value', s => {
                allDishesData =[]; 
                s.forEach(d => { allDishesData.push({ key: d.key, ...d.val() }); });
                renderDishes(allDishesData);
            });
        }

        function renderDishes(dishesList) {
            const c = document.getElementById('dishesContainer');
            c.innerHTML = '';
            if(dishesList.length === 0) { c.innerHTML = '<p style="padding:15px; color:#94a3b8; font-weight:500;">No dishes found.</p>'; return; }
            dishesList.forEach(d => {
                c.innerHTML += `<div class="card"><img src="${d.imageUrl}"><button class="add-btn" onclick="addToCart('${d.key}','${d.name}',${d.price},'${d.imageUrl}')"><i class="fas fa-plus"></i></button><div class="card-content"><h3>${d.name}</h3><p>鈧�${d.price}</p></div></div>`;
            });
        }

        document.querySelector('.search-bar input').addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            const filteredDishes = allDishesData.filter(dish => dish.name.toLowerCase().includes(searchTerm));
            renderDishes(filteredDishes);
        });

        window.addToCart = (id,name,price,img) => {
            const ex = cart.find(i=>i.id===id);
            ex ? ex.quantity++ : cart.push({id,name,price,img,quantity:1});
            updateCartUI();
        };

        function updateCartUI() {
            document.getElementById('cart-count').textContent = cart.reduce((a,b)=>a+b.quantity,0);
            const c = document.getElementById('cartItemsContainer');
            if(cart.length===0) { c.innerHTML='<p style="text-align:center; color:#94a3b8; font-weight:500; margin-top:50px;">Your cart is empty.</p>'; document.getElementById('cart-summary').style.display='none'; return; }
            document.getElementById('cart-summary').style.display='block';
            c.innerHTML='';
            let sub=0;
            cart.forEach(i => {
                sub+=i.price*i.quantity;
                c.innerHTML += `<div class="cart-item"><img src="${i.img}"><div style="flex:1;"><h4>${i.name}</h4><p>鈧�${i.price}</p></div><div class="qty-controls"><button onclick="modQty('${i.id}',-1)">-</button><span>${i.quantity}</span><button onclick="modQty('${i.id}',1)">+</button></div></div>`;
            });
            document.getElementById('subtotal-price').textContent = `鈧�${sub.toFixed(2)}`;
            document.getElementById('total-price').textContent = `鈧�${(sub+50).toFixed(2)}`;
        }

        window.modQty = (id,n) => {
            const i = cart.find(x=>x.id===id);
            if(i) { i.quantity+=n; if(i.quantity<=0) cart=cart.filter(x=>x.id!==id); updateCartUI(); }
        };

        // --- Notifications Logic ---
        function pushNotification(title, body) {
            if(!currentUser) return;
            const notif = {
                title: title,
                body: body,
                timestamp: Date.now(),
                read: false
            };
            db.ref(`notifications/${currentUser.uid}`).push(notif);
        }

        function listenForStatusUpdates() {
            if(!currentUser) return;
            db.ref('orders').orderByChild('userId').equalTo(currentUser.uid).on('child_changed', (snapshot) => {
                const order = snapshot.val();
                const orderId = snapshot.key.substring(1, 6);
                if (order.status !== 'Placed') { 
                    pushNotification(
                        `Order #${orderId} Update`, 
                        `Your order is now: ${order.status}`
                    );
                }
            });
        }

        function loadNotifications() {
            if(!currentUser) return;
            const container = document.getElementById('notificationListContainer');
            container.innerHTML = '<p style="text-align:center; padding:20px; color:#94a3b8; font-weight:500;">Loading alerts...</p>';
            
            db.ref(`notifications/${currentUser.uid}`).orderByChild('timestamp').limitToLast(20).once('value', snap => {
                container.innerHTML = '';
                if(!snap.exists()) {
                    container.innerHTML = '<div style="text-align:center; margin-top:60px; color:#cbd5e1;"><i class="fas fa-bell-slash" style="font-size:4em; margin-bottom:20px;"></i><p style="font-weight:600; font-size:1.1em; color:#94a3b8;">No notifications yet</p></div>';
                    return;
                }
                
                const alerts =[];
                snap.forEach(c => alerts.push(c.val()));
                alerts.reverse(); 

                alerts.forEach(n => {
                    const date = new Date(n.timestamp).toLocaleString();
                    let icon = 'fa-info-circle';
                    if(n.title.includes('Placed')) icon = 'fa-check-circle';
                    if(n.title.includes('Update')) icon = 'fa-shipping-fast';

                    container.innerHTML += `
                        <div class="notification-card">
                            <div class="notif-icon-box"><i class="fas ${icon}"></i></div>
                            <div class="notif-content">
                                <h4>${n.title}</h4>
                                <p>${n.body}</p>
                                <span class="notif-time">${date}</span>
                            </div>
                        </div>
                    `;
                });
            });
        }

        orderBtn.onclick = () => {
            const phone = phoneInput.value.trim();
            if(!isVerified && phone.length < 5) { alert("Please provide phone OR verify email."); return; }
            const address = document.getElementById('addressText').value;
            const lat = document.getElementById('lat').value;
            const lng = document.getElementById('lng').value;
            if(!address) { alert("Please provide an address."); return; }

            const order = {
                userId: currentUser.uid,
                email: currentUser.email,
                phone: phone || "Verified via Email",
                address, location: {lat,lng},
                items: cart, 
                total: (cart.reduce((a,b)=>a+b.price*b.quantity,0)+50).toFixed(2),
                status: 'Placed', method: 'Payment After Delivery',
                timestamp: new Date().toISOString()
            };
            
            db.ref('orders').push(order).then((snap) => { 
                pushNotification("Order Placed", `Order #${snap.key.substring(1,6)} has been placed successfully.`);
                cart=[]; updateCartUI(); 
                showPage('thankYouPage'); 
            });
        };

        // --- Orders List ---
        function loadOrders() {
            const container = document.getElementById('ordersListContainer');
            if (ordersListener) { ordersListener.off(); ordersListener = null; }
            if (!currentUser) return;

            container.innerHTML = '<p style="text-align:center; padding:20px; color:#94a3b8; font-weight:500;">Loading...</p>';
            ordersListener = db.ref('orders');
            
            ordersListener.on('value', s => {
                container.innerHTML = '';
                if (!s.exists()) { container.innerHTML = '<p style="text-align:center; color:#94a3b8; font-weight:500; padding:20px;">No active orders.</p>'; return; }
                const arr =[];
                s.forEach(childSnap => {
                    const val = childSnap.val();
                    if (val.userId === currentUser.uid) { arr.push({ k: childSnap.key, ...val }); }
                });
                if (arr.length === 0) { container.innerHTML = '<p style="text-align:center; color:#94a3b8; font-weight:500; padding:20px;">No active orders.</p>'; return; }
                arr.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

                let html = '';
                arr.forEach(o => {
                    let st = o.status;
                    let s1 = '', s2 = '', s3 = '', s4 = '';
                    if (st === 'Placed') s1 = 'active';
                    else if (st === 'Preparing') { s1 = 'passed'; s2 = 'active'; }
                    else if (st === 'Out for Delivery') { s1 = 'passed'; s2 = 'passed'; s3 = 'active'; }
                    else if (st === 'Delivered') { s1 = 'passed'; s2 = 'passed'; s3 = 'passed'; s4 = 'active'; }

                    html += `
                        <div class="order-card" id="order-${o.k}">
                            <div style="display:flex;justify-content:space-between;font-weight:700; font-size:1.1em; color:var(--text-color);">
                                <span>#${o.k.substring(1, 6)}</span>
                                <span style="color:var(--primary-color)">${st}</span>
                            </div>
                            <p style="color:var(--light-text); font-weight:500; font-size:0.95em; margin-top:8px;">${o.items.map(i => `${i.quantity}x ${i.name}`).join(', ')}</p>
                            <div class="track-bar">
                                <div class="track-step ${s1}"><div class="dot"></div><p>Placed</p></div>
                                <div class="track-step ${s2}"><div class="dot"></div><p>Prep</p></div>
                                <div class="track-step ${s3}"><div class="dot"></div><p>On Way</p></div>
                                <div class="track-step ${s4}"><div class="dot"></div><p>Done</p></div>
                            </div>
                            <div id="track-map-${o.k}" style="height:220px; width:100%; margin-top:25px; border-radius:16px; display:none; border:2px solid var(--primary-color); box-shadow:var(--card-shadow);"></div>
                            <p id="eta-${o.k}" style="text-align:center; font-size:0.85em; color:var(--light-text); font-weight:600; display:none; margin-top:10px;">Driver is moving...</p>
                        </div>
                    `;
                });
                container.innerHTML = html;
                setTimeout(() => {
                    arr.forEach(o => {
                        if (o.status === 'Out for Delivery') {
                            const mapId = `track-map-${o.k}`;
                            const mapEl = document.getElementById(mapId);
                            if(mapEl && mapEl.innerHTML === "") {
                                mapEl.style.display = 'block';
                                document.getElementById(`eta-${o.k}`).style.display = 'block';
                                try {
                                    const trackMap = L.map(mapId).setView([o.location.lat, o.location.lng], 14);
                                    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(trackMap);
                                    L.marker([o.location.lat, o.location.lng]).addTo(trackMap).bindPopup("Your Location");
                                    const carIcon = L.icon({ iconUrl: 'https://cdn-icons-png.flaticon.com/512/741/741407.png', iconSize: [30, 30] });
                                    let driverMarker = L.marker([o.location.lat, o.location.lng], {icon: carIcon}).addTo(trackMap);
                                    db.ref(`orders/${o.k}/driverLocation`).on('value', dSnap => {
                                        if(dSnap.exists()) {
                                            const dLoc = dSnap.val();
                                            driverMarker.setLatLng([dLoc.lat, dLoc.lng]);
                                            trackMap.setView([dLoc.lat, dLoc.lng]); 
                                        }
                                    });
                                } catch(e) { console.log('Map Error', e); }
                            }
                        }
                    });
                }, 300);
            });
        }
    </script>
</body>
</html>
