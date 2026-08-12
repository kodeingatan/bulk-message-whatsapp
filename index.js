import net from "net";
import { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import qrcode from 'qrcode-terminal'
import pino from 'pino'

import { HOST, PORT } from "./config.js";
import { parseJSON } from "./helpers.js";


// === GLOBAL SOCKET (penting!) ===
let queue = []
let sock = null
let isConnecting = false

async function startBot() {
    if (isConnecting) return
    isConnecting = true

    try {
        const { state, saveCreds } = await useMultiFileAuthState('auth_info')

        sock = makeWASocket({
            auth: state,
            logger: pino({ level: 'silent' }),
            browser: Browsers.ubuntu('Chrome'),
            markOnlineOnConnect: false,     // lebih aman (tidak selalu online)
            syncFullHistory: false,
        })

        // Simpan credentials
        sock.ev.on('creds.update', saveCreds)

        // === CONNECTION HANDLER ===
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update

            if (qr) {
                console.log('\n=== SCAN QR CODE ===')
                qrcode.generate(qr, { small: true })
                console.log('====================\n')
            }

            if (connection === 'open') {
                console.log('✅ Connection OPEN - siap kirim pesan kapan saja')
                isConnecting = false
            }

            if (connection === 'close') {
                const statusCode = (lastDisconnect?.error instanceof Boom)
                    ? lastDisconnect.error.output?.statusCode
                    : 0

                const shouldReconnect = statusCode !== DisconnectReason.loggedOut

                console.log('Connection closed. Status:', statusCode, '| Reconnect?', shouldReconnect)

                sock = null
                isConnecting = false

                if (shouldReconnect) {
                    // delay sedikit biar tidak spam reconnect
                    setTimeout(() => startBot(), 3000)
                } else {
                    console.log('❌ Logged out. Hapus folder auth_info lalu jalankan ulang.')
                }
            }
        })

        // === TERIMA PESAN ===
        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return

            const msg = messages[0]
            if (!msg.message || msg.key.fromMe) return

            const from = msg.key.remoteJid
            const text = msg.message.conversation ||
                msg.message.extendedTextMessage?.text || ''

            console.log(`📩 Dari ${from}: ${text}`)

            if (text.toLowerCase() === 'ping') {
                await sendMessage(from, 'pong 🏓')
            }
        })

    } catch (err) {
        console.error('Error startBot:', err)
        isConnecting = false
        setTimeout(() => startBot(), 5000)
    }
}

async function sendMessage(jid, text) {
    if (!sock) {
        console.log('⚠️ Socket belum siap')
        return false
    }

    try {
        await sock.sendMessage(jid, { text })
        console.log(`✅ Terkirim ke ${jid}`)
        return true
    } catch (err) {
        console.error('Gagal kirim pesan:', err.message)
        return false
    }
}

const server = net.createServer((socket) => {
    console.log("Client terhubung");

    socket.on("data", (data) => {
        const message = data.toString().trim();
        console.log("Pesan diterima:", message);

        const messageObject = parseJSON(message);
        if (messageObject) {
            const phoneNumber = messageObject?.phone;
            const textMessage = messageObject?.message;
            if (phoneNumber && textMessage) {
                console.log(`Menerima permintaan kirim pesan ke ${phoneNumber}: ${textMessage}`);
                setTimeout(async () => {
                    // Ganti nomor sesuai kebutuhan
                    await sendMessage(`${phoneNumber}@s.whatsapp.net`, textMessage)
                }, 15000)
                // queue.push({ phoneNumber, textMessage });
                // console.log(`✅ Pesan ke ${phoneNumber} ditambahkan ke antrian`);
            }
        }

    });

    socket.on("end", () => {
        console.log("Client terputus");
    });

    socket.on("error", (err) => {
        console.error("Socket error:", err.message);
    });
});

server.listen(PORT, HOST, () => {
    console.log(`Receiver TCP aktif di ${HOST}:${PORT}`);

    console.log("Jalankan startBot() untuk memulai koneksi ke WhatsApp");
    startBot()
});

server.on("error", (err) => {
    console.error("Server error:", err.message);
});