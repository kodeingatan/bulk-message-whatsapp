import { getFileExcelData, handleFileOpen } from "./helpers.js";
import { sendWAMessage } from "./sender.js";


(async () => {
    try {
        const pathOpen = await handleFileOpen({
            title: "Pilih file Excel",
            filters: "*.xlsx;*.xls",
        });

        const rows = getFileExcelData(pathOpen);

        for (const row of rows) {
            const phone = row?.["WA Number"];
            const message = row?.["WA Message"];

            if (phone && message) {
                await sendWAMessage(phone, message);
                console.log(`✅ Pesan berhasil dikirim ke ${phone} :  ${message?.substring(0, 20)}...`);
            }
        }
    } catch (error) {
        console.error("Error:", error.message);
    }

})()