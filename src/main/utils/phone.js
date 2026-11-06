export function normalizePhone(raw) {
  if (raw === null || raw === undefined) return "";

  let phone = String(raw).trim();
  if (!phone) return "";

  phone = phone.replace(/^whatsapp:/i, "").replace(/@.*$/, "");
  phone = phone.replace(/\D/g, "");

  if (!phone) return "";
  if (phone.startsWith("0")) phone = `62${phone.slice(1)}`;
  else if (/^8\d{7,11}$/.test(phone)) phone = `62${phone}`;

  return phone;
}
