import { sendWAMessage } from "../sender.js";


(async () => {
    for (let i = 0; i < 5; i++) {
        console.log(`Mengirim pesan ke-${i + 1} dari bot...`);
        await sendWAMessage("62895708870305", `Pesan ke-${i + 1} dari bot`)
        console.log(`✅ Pesan ke-${i + 1} berhasil dikirim!`);
    }
})()