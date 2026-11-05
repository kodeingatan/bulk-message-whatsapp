import net from "net";
import { HOST, PORT } from "./config.js";


function sendMessage(message) {
    const client = net.createConnection({ port: PORT, host: HOST }, () => {
        client.write(message + "\n");
        client.end(); // langsung tutup setelah kirim
    });

    client.on("error", (err) => {
        console.error("Gagal mengirim:", err.message);
        console.log("Pastikan receiver (index.js) sudah dijalankan!");
    });
}

function sendMessageJSON(objectMessage) {
    sendMessage(JSON.stringify(objectMessage));
}

async function sendWAMessage(phoneNumber, textMessage) {
    sendMessageJSON({ phone: phoneNumber, message: textMessage });
    await new Promise((resolve) => setTimeout(resolve, 15000));
}

const pesan = process.argv[2] || "Pesan default";
sendMessage(pesan);

export { sendMessage, sendMessageJSON, sendWAMessage };