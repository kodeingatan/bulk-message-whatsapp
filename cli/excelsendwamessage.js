import { getFileExcelData, handleFileOpen } from "./helpers.js";
import { sendWAMessage } from "./sender.js";


(async () => {
    try {
        const pathOpen = await handleFileOpen({
            title: "Pilih file Excel",
            filters: "*.xlsx;*.xls",
        });

        const rows = getFileExcelData(pathOpen);

        let totalRows = rows.length;
        let sentCount = 0;

        console.log(`Bersiap mengirim pesan ke ${totalRows} nomor dari file Excel...`);
        for (const row of rows) {
            const phone = row?.["WA Number"];
            const message = row?.["WA Message"];
            const sendStatus = row?.["WA Send Status"];

            if (phone && message && sendStatus != "DONE") {
                await sendWAMessage(phone, message);
                sentCount++;
                console.log(`✅ Pesan berhasil dikirim ke ${phone} :  ${message?.substring(0, 20)}... (${sentCount}/${totalRows})`);
            }
        }
        console.log(`✅ Selesai! Dari ${totalRows} nomor, ${sentCount} pesan berhasil dikirim.`);
    } catch (error) {
        console.error("Error:", error.message);
    }

})()